import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeJson } from "../src/memory/canonical.js";
import type { JsonObject } from "../src/memory/types.js";
import { sha256Hex } from "../src/memory/hash.js";
import {
  createX402FacilitatorHttpServer,
  type X402FacilitatorHttpServerConfig
} from "../src/x402/facilitator.js";
import { createX402PaidResourceHttpServer } from "../src/x402/resource.js";
import {
  loadCasperSigningKey,
  signX402PaymentPayload,
  type CasperSigningKey
} from "../src/x402/signer.js";
import type { X402CasperCliSettlementConfig } from "../src/x402/settlement.js";

const BUYER_ACCOUNT_HASH =
  "account-hash-1111111111111111111111111111111111111111111111111111111111111111";
const PAYEE_PUBLIC_KEY = `02${"2".repeat(66)}`;
const RESOURCE_PATH = "/weather";
const POLICY_HASH = "b".repeat(64);

const openServers: Server[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await closeServer(openServers.pop()!);
  }
});

describe("Casper x402 paid resource server", () => {
  it("returns PAYMENT-REQUIRED on the first unauthenticated request", async () => {
    const resource = await listenResource({
      facilitatorUrl: "http://127.0.0.1:4022"
    });

    const response = await fetch(resourceUrl(resource));
    const body = await response.text();

    expect(response.status).toBe(402);
    expect(response.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    expect(body).toContain("x402Version");
    expect(body).not.toContain("sunny");
  });

  it("returns the resource only after facilitator verify and settled transaction", async () => {
    const transactionHash = "d".repeat(64);
    const calls: string[] = [];
    const facilitator = await listenFacilitator({
      commandRunner: async (_command, args) => {
        calls.push(String(args[0]));
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
    const resource = await listenResource({
      facilitatorUrl: facilitatorUrl(facilitator)
    });

    const response = await paidFetch(resource);
    const body = (await response.json()) as Record<string, unknown>;
    const paymentResponse = parseBase64Json(response.headers.get("PAYMENT-RESPONSE") ?? "");

    expect(calls).toEqual(["put-transaction", "get-transaction"]);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      weather: "sunny",
      settlement: "settled"
    });
    expect(paymentResponse).toMatchObject({
      success: true,
      settled: true,
      transactionHash
    });
  });

  it("rejects failed verification without leaking the resource", async () => {
    const facilitator = await listenFacilitator();
    const resource = await listenResource({
      facilitatorUrl: facilitatorUrl(facilitator)
    });
    const signedPayload = signedPaymentPayload(
      resourceUrl(resource),
      validRequirement(resourceUrl(resource))
    );
    const authorization = signedPayload.authorization as JsonObject;
    const signature = String(authorization.signature);
    authorization.signature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;

    const response = await fetch(resourceUrl(resource), {
      headers: {
        "PAYMENT-SIGNATURE": encodeBase64Json(signedPayload)
      }
    });
    const body = await response.text();

    expect(response.status).toBe(402);
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeNull();
    expect(response.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    expect(body).toContain("payment_verify_failed");
    expect(body).not.toContain("sunny");
  });

  it("rejects failed settlement without PAYMENT-RESPONSE or resource leakage", async () => {
    const transactionHash = "e".repeat(64);
    const facilitator = await listenFacilitator({
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
    const resource = await listenResource({
      facilitatorUrl: facilitatorUrl(facilitator)
    });

    const response = await paidFetch(resource);
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeNull();
    expect(body).toContain("payment_settlement_not_verified");
    expect(body).not.toContain("sunny");
  });
});

async function listenResource(input: { facilitatorUrl: string }): Promise<Server> {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}${RESOURCE_PATH}`;
  const resource = createX402PaidResourceHttpServer({
    resourcePath: RESOURCE_PATH,
    facilitatorUrl: input.facilitatorUrl,
    paymentRequirements: paymentRequirements(url),
    resourceBody: {
      weather: "sunny",
      unit: "celsius",
      temperature: 22,
      source: "casper-x402-resource",
      settlement: "settled"
    }
  });
  resource.listen(port, "127.0.0.1");
  await once(resource, "listening");
  openServers.push(resource);
  return resource;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  server.close();
  await once(server, "close");
  return address.port;
}

async function listenFacilitator(
  overrides: Partial<X402FacilitatorHttpServerConfig> = {}
): Promise<Server> {
  const server = createX402FacilitatorHttpServer({
    facilitatorUrl: "http://127.0.0.1:4022",
    settlementConfig: casperCliConfig(),
    now: fixedNow,
    ...overrides
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  openServers.push(server);
  return server;
}

async function paidFetch(resource: Server): Promise<Response> {
  const url = resourceUrl(resource);
  const requirement = validRequirement(url);
  const payload = signedPaymentPayload(url, requirement);
  return fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": encodeBase64Json(payload)
    }
  });
}

function signedPaymentPayload(url: string, requirement: JsonObject): JsonObject {
  const { signingKey } = createEd25519SigningKey();
  const result = signX402PaymentPayload(
    {
      payment_id: "pay_demo_001",
      facilitator_url: "http://127.0.0.1:4022",
      method: "GET",
      url,
      selected_requirement: requirement,
      selected_requirement_hash: payloadHash(requirement),
      policy_hash: POLICY_HASH
    },
    {
      signingKey,
      buyerAccountHash: BUYER_ACCOUNT_HASH,
      now: fixedNow
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

function paymentRequirements(url: string): JsonObject {
  return {
    x402Version: 2,
    accepts: [validRequirement(url)],
    facilitator: "http://127.0.0.1:4022"
  };
}

function validRequirement(url: string): JsonObject {
  return {
    scheme: "exact",
    network: "casper:casper-test",
    maxAmountRequired: "2500000000",
    amount: "2500000000",
    resource: url,
    method: "GET",
    asset: "casper-native-cspr",
    payTo: PAYEE_PUBLIC_KEY,
    maxTimeoutSeconds: 60
  };
}

function resourceUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return `http://127.0.0.1:${address.port}${RESOURCE_PATH}`;
}

function facilitatorUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  server.close();
  await once(server, "close");
}

function payloadHash(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}

function fixedNow(): Date {
  return new Date("2026-06-05T00:00:00.000Z");
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function parseBase64Json(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
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
