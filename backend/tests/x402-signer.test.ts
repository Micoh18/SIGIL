import { generateKeyPairSync } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/audit/service.js";
import { FileAuditStore } from "../src/audit/store.js";
import { GrimoireService } from "../src/grimoire/service.js";
import { FileGrimoireStore } from "../src/grimoire/store.js";
import { canonicalizeJson } from "../src/memory/canonical.js";
import type { JsonObject } from "../src/memory/types.js";
import { sha256Hex } from "../src/memory/hash.js";
import { PaymentService } from "../src/payments/service.js";
import { FilePaymentStore } from "../src/payments/store.js";
import type { X402ChallengeRequest, X402ChallengeResult } from "../src/x402/client.js";
import {
  createX402SignerHttpServer,
  loadCasperSigningKey,
  signX402PaymentPayload,
  validateX402SignerRequest,
  type CasperSigningKey
} from "../src/x402/signer.js";
import {
  HttpX402SigningProvider,
  ResourceRetryX402SettlementProvider
} from "../src/x402/settlement.js";

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

describe("Casper x402 signer sidecar", () => {
  it("signs a stable canonical payload for the same approved requirement", () => {
    const { signingKey } = createEd25519SigningKey();
    const firstRequirement = validRequirement();
    const reorderedRequirement = {
      method: "GET",
      resource: RESOURCE_URL,
      amount: "2500000000",
      maxAmountRequired: "2500000000",
      network: "casper:casper-test",
      scheme: "exact",
      asset: "casper-native-cspr",
      payTo: PAYEE_PUBLIC_KEY,
      maxTimeoutSeconds: 60
    };

    const first = signX402PaymentPayload(signRequest(firstRequirement), {
      signingKey,
      buyerAccountHash: BUYER_ACCOUNT_HASH,
      now: fixedNow
    });
    const second = signX402PaymentPayload(signRequest(reorderedRequirement), {
      signingKey,
      buyerAccountHash: BUYER_ACCOUNT_HASH,
      now: fixedNow
    });

    expect(first.signed).toBe(true);
    expect(second.signed).toBe(true);
    if (first.signed && second.signed) {
      expect(payloadHash(first.signed_payload)).toBe(payloadHash(second.signed_payload));
      expect(first.signed_payload.authorization).toMatchObject({
        publicKey: signingKey.publicKey,
        signature: expect.stringMatching(/^01[a-f0-9]{128}$/),
        authorizationHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
    }
  });

  it("creates stable secp256k1 Casper signatures", () => {
    const { signingKey } = createSecp256k1SigningKey();
    const request = signRequest(validRequirement());

    const first = signX402PaymentPayload(request, {
      signingKey,
      buyerAccountHash: BUYER_ACCOUNT_HASH,
      now: fixedNow
    });
    const second = signX402PaymentPayload(request, {
      signingKey,
      buyerAccountHash: BUYER_ACCOUNT_HASH,
      now: fixedNow
    });

    expect(signingKey.publicKey).toMatch(/^02(02|03)[a-f0-9]{64}$/);
    expect(first.signed).toBe(true);
    expect(second.signed).toBe(true);
    if (first.signed && second.signed) {
      expect(payloadHash(first.signed_payload)).toBe(payloadHash(second.signed_payload));
      expect(first.signed_payload.authorization).toMatchObject({
        signature: expect.stringMatching(/^02[a-f0-9]{128}$/)
      });
    }
  });

  it("rejects invalid requirements before invoking the signing primitive", () => {
    const { signingKey } = createEd25519SigningKey();
    let signCalls = 0;
    const result = signX402PaymentPayload(
      {
        ...signRequest(validRequirement()),
        selected_requirement_hash: "a".repeat(64)
      },
      {
        signingKey,
        buyerAccountHash: BUYER_ACCOUNT_HASH,
        now: fixedNow,
        signBytes() {
          signCalls += 1;
          return `01${"0".repeat(128)}`;
        }
      }
    );

    expect(result).toEqual({
      signed: false,
      reason: "selected_requirement_hash_mismatch"
    });
    expect(signCalls).toBe(0);
  });

  it("returns only signed_payload from POST /sign", async () => {
    const { privatePem, signingKey } = createEd25519SigningKey();
    const logs: string[] = [];
    const server = await listenSigner(signingKey, logs);

    const response = await fetch(signerUrl(server), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-signer-token"
      },
      body: JSON.stringify(signRequest(validRequirement()))
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(["signed_payload"]);
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
    assertNoPrivateKeyMaterial(JSON.stringify(body), privatePem);
    assertNoPrivateKeyMaterial(JSON.stringify(logs), privatePem);
  });

  it("keeps private key material out of signer response, receipt, audit, and logs", async () => {
    const { privatePem, signingKey } = createEd25519SigningKey();
    const logs: string[] = [];
    const server = await listenSigner(signingKey, logs);
    const signerRequest = signRequest(validRequirement());

    const signerResponse = await fetch(signerUrl(server), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-signer-token"
      },
      body: JSON.stringify(signerRequest)
    });
    const signerResponseText = await signerResponse.text();

    const { payment, audit } = await createPaymentFixture(server);
    const result = await payment.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: RESOURCE_URL,
      expected_amount: "2500000000",
      request_challenge: true
    });
    const receipt = await payment.receipt(result.payment_id);
    const auditTail = await audit.tail({ agent_id: "agent-demo-1", limit: 20 });
    const observableOutput = JSON.stringify({
      signerResponseText,
      result,
      receipt,
      auditTail,
      logs
    });

    expect(signerResponse.status).toBe(200);
    expect(result.allowed && result.status).toBe("settled");
    expect(receipt.receipt?.settlement_status).toBe("settled");
    expect(observableOutput).not.toContain("PRIVATE KEY");
    assertNoPrivateKeyMaterial(observableOutput, privatePem);
  });

  it("rejects sensitive or mismatched signer requests", () => {
    const requirementWithPrivateKey = {
      ...validRequirement(),
      privateKey: "must-not-sign"
    };
    const mismatchedMethod = {
      ...signRequest(validRequirement()),
      method: "POST"
    };

    expect(validateX402SignerRequest(signRequest(requirementWithPrivateKey))).toEqual({
      ok: false,
      reason: "selected_requirement_sensitive_field"
    });
    expect(validateX402SignerRequest(mismatchedMethod)).toEqual({
      ok: false,
      reason: "method_mismatch"
    });
  });
});

async function createPaymentFixture(server: Server): Promise<{
  audit: AuditService;
  payment: PaymentService;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "sigil-x402-signer-flow-"));
  const audit = new AuditService(new FileAuditStore(dataDir));
  const grimoire = new GrimoireService(
    new FileGrimoireStore(dataDir),
    Buffer.alloc(32, 1),
    audit
  );
  const requirement = validRequirement();
  const challenge = {
    x402Version: 2,
    accepts: [requirement],
    facilitator: "http://localhost:4022"
  };

  await grimoire.setPolicy({
    agent_id: "agent-demo-1",
    policy_id: "pol-demo",
    enabled: true,
    allowed_urls: [RESOURCE_URL],
    allowed_methods: ["GET"],
    allowed_asset: {
      caip2_chain_id: "casper:casper-test",
      asset: "casper-native-cspr",
      pay_to: PAYEE_PUBLIC_KEY,
      scheme: "exact"
    },
    max_amount_per_call: "2500000000",
    max_amount_per_period: "25000000000",
    period_seconds: 86400,
    secret_scopes: ["x402:sign"]
  });

  const signer = new HttpX402SigningProvider({
    signerUrl: signerUrl(server),
    authToken: "test-signer-token",
    now: fixedNow
  });
  const settlement = new ResourceRetryX402SettlementProvider(
    signer,
    async (_url, init) => {
      const signedPayload = JSON.parse(
        Buffer.from(init.headers["PAYMENT-SIGNATURE"]!, "base64").toString("utf8")
      ) as JsonObject;
      return {
        status: 200,
        headers: new Headers({
          "PAYMENT-RESPONSE": Buffer.from(
            JSON.stringify({
              success: true,
              transactionHash: "d".repeat(64),
              network: "casper:casper-test",
              asset: "casper-native-cspr",
              amount: "2500000000",
              payer: signedPayload.payer,
              payTo: PAYEE_PUBLIC_KEY
            }),
            "utf8"
          ).toString("base64")
        }),
        bodyText: JSON.stringify({ weather: "sunny" })
      };
    },
    { now: fixedNow }
  );

  return {
    audit,
    payment: new PaymentService(
      grimoire,
      new FilePaymentStore(dataDir),
      audit,
      {
        async requestChallenge(input: X402ChallengeRequest): Promise<X402ChallengeResult> {
          return {
            status: "payment_required",
            status_code: 402,
            requirements: challenge,
            requirements_json: JSON.stringify(challenge),
            requirements_source: "json-body",
            raw_body: JSON.stringify(challenge),
            facilitator_url: "http://localhost:4022",
            resource_url: RESOURCE_URL,
            request_url: input.url,
            settlement_status: "not_started"
          };
        }
      },
      settlement
    )
  };
}

async function listenSigner(signingKey: CasperSigningKey, logs: string[]): Promise<Server> {
  const server = createX402SignerHttpServer({
    signingKey,
    buyerAccountHash: BUYER_ACCOUNT_HASH,
    authToken: "test-signer-token",
    now: fixedNow,
    logger: {
      info(message) {
        logs.push(message);
      },
      warn(message) {
        logs.push(message);
      },
      error(message) {
        logs.push(message);
      }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  openServers.push(server);
  return server;
}

function signerUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return `http://127.0.0.1:${address.port}/sign`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  server.close();
  await once(server, "close");
}

function createEd25519SigningKey(): {
  privatePem: string;
  signingKey: CasperSigningKey;
} {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    privatePem,
    signingKey: loadCasperSigningKey(privatePem)
  };
}

function createSecp256k1SigningKey(): {
  signingKey: CasperSigningKey;
} {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    signingKey: loadCasperSigningKey(privatePem)
  };
}

function signRequest(requirement: JsonObject): JsonObject {
  return {
    payment_id: "pay_demo_001",
    facilitator_url: "http://localhost:4022",
    method: "GET",
    url: RESOURCE_URL,
    selected_requirement: requirement,
    selected_requirement_hash: payloadHash(requirement),
    policy_hash: POLICY_HASH
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
  return new Date("2026-06-05T00:00:30.000Z");
}

function assertNoPrivateKeyMaterial(output: string, privatePem: string): void {
  for (const line of privatePem.split(/\r?\n/)) {
    if (!line || line.includes("PRIVATE KEY")) {
      continue;
    }

    expect(output).not.toContain(line);
  }
}
