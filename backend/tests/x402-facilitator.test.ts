import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeJson } from "../src/memory/canonical.js";
import type { JsonObject } from "../src/memory/types.js";
import { sha256Hex } from "../src/memory/hash.js";
import {
  createX402FacilitatorHttpServer,
  type X402FacilitatorHttpServerConfig
} from "../src/x402/facilitator.js";
import {
  loadCasperSigningKey,
  signX402PaymentPayload,
  type CasperSigningKey
} from "../src/x402/signer.js";
import type { X402CasperCliSettlementConfig } from "../src/x402/settlement.js";

const BUYER_ACCOUNT_HASH =
  "account-hash-1111111111111111111111111111111111111111111111111111111111111111";
const PAYEE_PUBLIC_KEY = `02${"2".repeat(66)}`;
const RESOURCE_URL = "http://localhost:4021/weather";
const POLICY_HASH = "b".repeat(64);

const openServers: Server[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await closeServer(openServers.pop()!);
  }
});

describe("Casper x402 facilitator sidecar", () => {
  it("verifies a signed payload without submitting Casper settlement", async () => {
    const signedPayload = signedPaymentPayload();
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const server = await listenFacilitator({
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 1, stdout: "", stderr: "must not be called by verify" };
      }
    });

    const response = await postJson(facilitatorUrl(server, "/verify"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      valid: true,
      network: "casper:casper-test",
      asset: "casper-native-cspr",
      amount: "2500000000",
      payTo: PAYEE_PUBLIC_KEY
    });
    expect(body).not.toHaveProperty("success");
    expect(body).not.toHaveProperty("settled");
    expect(body).not.toHaveProperty("transactionHash");
    expect(calls).toEqual([]);
  });

  it("settles only after Casper execution succeeds and rejects replay", async () => {
    const signedPayload = signedPaymentPayload();
    const transactionHash = "d".repeat(64);
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const server = await listenFacilitator({
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        if (args[0] === "put-transaction") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              result: {
                transaction_hash: {
                  Version1: transactionHash
                }
              }
            }),
            stderr: ""
          };
        }

        return {
          exitCode: 0,
          stdout: JSON.stringify({
            result: {
              execution_info: [{ error_message: null }]
            }
          }),
          stderr: ""
        };
      }
    });

    const verify = await postJson(facilitatorUrl(server, "/verify"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    expect(verify.status).toBe(200);

    const settle = await postJson(facilitatorUrl(server, "/settle"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    const settleBody = (await settle.json()) as Record<string, unknown>;

    expect(calls.map((call) => call.args[0])).toEqual(["put-transaction", "get-transaction"]);
    expect(settle.status).toBe(200);
    expect(settleBody).toMatchObject({
      success: true,
      settled: true,
      transactionHash,
      transaction: transactionHash,
      network: "casper:casper-test",
      asset: "casper-native-cspr",
      amount: "2500000000",
      payer: BUYER_ACCOUNT_HASH,
      payTo: PAYEE_PUBLIC_KEY
    });

    const replay = await postJson(facilitatorUrl(server, "/settle"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    const replayBody = (await replay.json()) as Record<string, unknown>;

    expect(replay.status).toBe(409);
    expect(replayBody).toMatchObject({
      success: false,
      settled: false,
      error: "payment_replayed",
      reason: "payment_payload_replayed"
    });
  });

  it("rejects tampered signatures before settlement", async () => {
    const signedPayload = signedPaymentPayload();
    const authorization = signedPayload.authorization as JsonObject;
    const signature = String(authorization.signature);
    authorization.signature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    const server = await listenFacilitator();

    const response = await postJson(facilitatorUrl(server, "/verify"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      valid: false,
      success: false,
      reason: "signature_invalid"
    });
  });

  it("rejects stale payloads before settlement", async () => {
    const signedPayload = signedPaymentPayload({
      now: () => new Date("2026-06-04T23:58:00.000Z")
    });
    const server = await listenFacilitator();

    const response = await postJson(facilitatorUrl(server, "/verify"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      valid: false,
      success: false,
      reason: "payment_expired"
    });
  });

  it.each([
    {
      name: "wrong payee",
      mutate(payload: JsonObject) {
        payload.payTo = `02${"3".repeat(66)}`;
      },
      reason: "payee_mismatch"
    },
    {
      name: "wrong amount",
      mutate(payload: JsonObject) {
        payload.amount = "9999999999";
      },
      reason: "amount_mismatch"
    },
    {
      name: "wrong asset",
      mutate(payload: JsonObject) {
        payload.asset = "other-asset";
      },
      reason: "asset_mismatch"
    },
    {
      name: "wrong network",
      mutate(payload: JsonObject) {
        payload.network = "casper:casper-main";
      },
      reason: "network_mismatch"
    },
    {
      name: "wrong resource",
      mutate(payload: JsonObject) {
        payload.resource = "http://localhost:4021/other";
      },
      reason: "resource_mismatch"
    }
  ])("rejects $name before settlement", async ({ mutate, reason }) => {
    const signedPayload = signedPaymentPayload();
    mutate(signedPayload);
    const server = await listenFacilitator({
      commandRunner: async () => {
        throw new Error("settlement must not be called");
      }
    });

    const response = await postJson(facilitatorUrl(server, "/verify"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      valid: false,
      success: false,
      reason
    });
  });

  it("returns failed settlement when Casper execution fails", async () => {
    const signedPayload = signedPaymentPayload();
    const transactionHash = "e".repeat(64);
    const server = await listenFacilitator({
      commandRunner: async (_command, args) =>
        args[0] === "put-transaction"
          ? {
              exitCode: 0,
              stdout: JSON.stringify({
                result: {
                  transaction_hash: {
                    Version1: transactionHash
                  }
                }
              }),
              stderr: ""
            }
          : {
              exitCode: 0,
              stdout: JSON.stringify({
                result: {
                  execution_info: [{ error_message: "Insufficient allowance" }]
                }
              }),
              stderr: ""
            }
    });

    const settle = await postJson(facilitatorUrl(server, "/settle"), {
      paymentPayload: signedPayload,
      paymentRequirements: validRequirement()
    });
    const body = (await settle.json()) as Record<string, unknown>;

    expect(settle.status).toBe(200);
    expect(body).toMatchObject({
      success: false,
      settled: false,
      error: "settlement_failed",
      reason: "x402_casper_transaction_execution_failed",
      transactionHash,
      network: "casper:casper-test",
      asset: "casper-native-cspr",
      amount: "2500000000",
      payer: BUYER_ACCOUNT_HASH,
      payTo: PAYEE_PUBLIC_KEY
    });
  });
});

async function listenFacilitator(
  overrides: Partial<X402FacilitatorHttpServerConfig> = {}
): Promise<Server> {
  const server = createX402FacilitatorHttpServer({
    facilitatorUrl: "http://localhost:4022",
    settlementConfig: casperCliConfig(),
    now: fixedNow,
    ...overrides
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  openServers.push(server);
  return server;
}

function facilitatorUrl(server: Server, path: "/verify" | "/settle"): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return `http://127.0.0.1:${address.port}${path}`;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  server.close();
  await once(server, "close");
}

function signedPaymentPayload(
  options: {
    now?: () => Date;
  } = {}
): JsonObject {
  const { signingKey } = createEd25519SigningKey();
  const requirement = validRequirement();
  const result = signX402PaymentPayload(
    {
      payment_id: "pay_demo_001",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: RESOURCE_URL,
      selected_requirement: requirement,
      selected_requirement_hash: payloadHash(requirement),
      policy_hash: POLICY_HASH
    },
    {
      signingKey,
      buyerAccountHash: BUYER_ACCOUNT_HASH,
      now: options.now ?? fixedNow
    }
  );

  if (!result.signed) {
    throw new Error(`Unable to sign payload: ${result.reason}`);
  }

  return structuredClone(result.signed_payload);
}

function createEd25519SigningKey(): {
  signingKey: CasperSigningKey;
} {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    signingKey: loadCasperSigningKey(privatePem)
  };
}

function validRequirement(): JsonObject {
  return {
    scheme: "exact",
    network: "casper:casper-test",
    maxAmountRequired: "2500000000",
    amount: "2500000000",
    resource: RESOURCE_URL,
    method: "GET",
    asset: "casper-native-cspr",
    payTo: PAYEE_PUBLIC_KEY,
    maxTimeoutSeconds: 60
  };
}

function payloadHash(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}

function fixedNow(): Date {
  return new Date("2026-06-05T00:00:00.000Z");
}

function casperCliConfig(): X402CasperCliSettlementConfig & {
  rpcUrl: string;
  accountKeyPath: string;
} {
  return {
    networkName: "casper-test",
    caip2ChainId: "casper:casper-test",
    rpcUrl: "https://node.test/rpc",
    accountKeyPath: "./keys/facilitator.pem",
    submissionEnabled: true,
    clientBin: "casper-client",
    clientWslDistro: null,
    gasPriceTolerance: "10",
    pricingMode: "classic",
    paymentAmountMotes: "7000000000",
    confirmationPollIntervalMs: 1,
    confirmationTimeoutMs: 1
  };
}
