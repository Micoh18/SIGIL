import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { PolicyRecord } from "../src/grimoire/types.js";
import type { JsonObject } from "../src/memory/types.js";
import { X402ChallengeClient } from "../src/x402/client.js";
import {
  approveX402Requirements,
  validateX402PaymentPayload,
  verifyX402SettlementResponse
} from "../src/x402/readiness.js";
import {
  buildCasperX402SettlementCommand,
  CasperCliX402SettlementProvider,
  createSignedPayloadHash,
  DisabledX402SettlementProvider,
  FacilitatorX402SettlementProvider,
  HttpX402SigningProvider,
  ResourceRetryX402SettlementProvider,
  verifyCasperTransactionExecution,
  type X402CasperCliSettlementConfig
} from "../src/x402/settlement.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("x402 foundation", () => {
  it("loads Casper x402 configuration from environment", () => {
    const config = loadConfig({
      X402_FACILITATOR_URL: "http://localhost:4022",
      X402_RESOURCE_DEMO_URL: "http://localhost:4021/weather",
      X402_ASSET_PACKAGE: "asset-package-hash",
      X402_ENABLE_REAL_SETTLEMENT: "true",
      CASPER_CAIP2_CHAIN_ID: "casper:casper-test"
    });

    expect(config.x402.facilitatorUrl).toBe("http://localhost:4022");
    expect(config.x402.resourceDemoUrl).toBe("http://localhost:4021/weather");
    expect(config.x402.assetPackage).toBe("asset-package-hash");
    expect(config.x402.settlementEnabled).toBe(true);
    expect(config.x402.settlementMode).toBe("resource-retry");
    expect(config.x402.casperSettlementPaymentAmountMotes).toBe("7000000000");
    expect(config.x402.signerUrl).toBeNull();
    expect(config.casper.caip2ChainId).toBe("casper:casper-test");
  });

  it("parses an HTTP 402 JSON challenge without attempting settlement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [
          {
            scheme: "exact",
            network: "casper:casper-test",
            maxAmountRequired: "0.01",
            amount: "0.01",
            resource: "weather",
            method: "GET",
            asset: "asset-package-hash",
            payTo: "casper-payee",
            maxTimeoutSeconds: 60
          }
        ]
      }),
          { status: 402, headers: { "content-type": "application/json" } }
        )
      )
    );
    const client = new X402ChallengeClient({
      facilitatorUrl: "http://localhost:4022",
      resourceUrl: "http://localhost:4021/weather"
    });

    const challenge = await client.requestChallenge({
      method: "GET",
      url: "http://localhost:4021/weather"
    });

    expect(challenge.status).toBe("payment_required");
    expect(challenge.status_code).toBe(402);
    expect(challenge.requirements).toMatchObject({ x402Version: 1 });
    expect(challenge.requirements_source).toBe("json-body");
    expect(challenge.requirements_json).toContain("x402Version");
    expect(challenge.facilitator_url).toBe("http://localhost:4022");
    expect(challenge.resource_url).toBe("http://localhost:4021/weather");
    expect(challenge.settlement_status).toBe("not_started");
  });

  it("prefers standard x402 payment requirements headers when present", async () => {
    const requirements = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "casper:casper-test",
          maxAmountRequired: "0.01",
          amount: "0.01",
          resource: "http://localhost:4021/weather",
          method: "GET",
          asset: "asset-package-hash",
          payTo: "casper-payee",
          maxTimeoutSeconds: 60
        }
      ]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(requirements), "utf8").toString(
              "base64"
            )
          }
        })
      )
    );
    const client = new X402ChallengeClient();

    const challenge = await client.requestChallenge({
      method: "GET",
      url: "http://localhost:4021/weather"
    });

    expect(challenge.status).toBe("payment_required");
    expect(challenge.requirements).toMatchObject({ x402Version: 2 });
    expect(challenge.requirements_source).toBe("payment-required-header");
  });

  it("hashes a free response body and marks payment as unnecessary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ weather: "sunny" }), { status: 200 }))
    );
    const client = new X402ChallengeClient();

    const result = await client.requestChallenge({
      method: "GET",
      url: "http://localhost:4021/weather"
    });

    expect(result.status).toBe("free_response");
    expect(result.status_code).toBe(200);
    expect(result.response_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.settlement_status).toBe("not_required");
  });

  it("approves only policy-matching payment requirements before signing", () => {
    const policy = createPolicy({
      allowed_asset: {
        caip2_chain_id: "casper:casper-test",
        asset_package: "asset-package-hash",
        pay_to: "casper-payee",
        scheme: "exact"
      }
    });

    const approval = approveX402Requirements({
      requirements: {
        x402Version: 1,
        accepts: [
        {
          ...validRequirement(),
          resource: "http://localhost:4021/weather"
        }
      ]
    },
      policy,
      method: "GET",
      url: "http://localhost:4021/weather",
      expectedAmount: "0.01"
    });

    expect(approval.approved).toBe(true);
    if (approval.approved) {
      expect(approval.selected_index).toBe(0);
      expect(approval.selected_requirement_hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("rejects requirement resource, amount, asset, and payee mismatches", () => {
    const policy = createPolicy({
      allowed_asset: {
        caip2_chain_id: "casper:casper-test",
        asset_package: "asset-package-hash",
        pay_to: "casper-payee"
      }
    });

    const approval = approveX402Requirements({
      requirements: {
        x402Version: 1,
        accepts: [
          {
            ...validRequirement(),
            maxAmountRequired: "0.02",
            amount: "0.02"
          },
          {
            ...validRequirement(),
            resource: "http://localhost:4021/other",
          },
          {
            ...validRequirement(),
            asset: "other-asset"
          },
          {
            ...validRequirement(),
            payTo: "other-payee"
          }
        ]
      },
      policy,
      method: "GET",
      url: "http://localhost:4021/weather",
      expectedAmount: "0.01"
    });

    expect(approval.approved).toBe(false);
    if (!approval.approved) {
      const reasons = approval.rejected_candidates.map((candidate) => candidate.reason);
      expect(approval.reason).toBe("no_acceptable_requirement");
      expect(reasons).toEqual([
        "expected_amount_mismatch",
        "resource_mismatch",
        "asset_mismatch",
        "payee_mismatch"
      ]);
    }
  });

  it("rejects Casper payment requirements that omit required protocol fields", () => {
    const policy = createPolicy({
      allowed_asset: {
        caip2_chain_id: "casper:casper-test",
        asset_package: "asset-package-hash",
        pay_to: "casper-payee",
        scheme: "exact"
      }
    });
    const candidates = [
      withoutKey(validRequirement(), "maxAmountRequired", "amount"),
      withoutKey(validRequirement(), "resource"),
      withoutKey(validRequirement(), "method"),
      withoutKey(validRequirement(), "network"),
      withoutKey(validRequirement(), "asset"),
      withoutKey(validRequirement(), "payTo"),
      withoutKey(validRequirement(), "scheme"),
      withoutKey(validRequirement(), "maxTimeoutSeconds")
    ];

    const approval = approveX402Requirements({
      requirements: {
        x402Version: 2,
        accepts: candidates
      },
      policy,
      method: "GET",
      url: "http://localhost:4021/weather",
      expectedAmount: "0.01"
    });

    expect(approval.approved).toBe(false);
    if (!approval.approved) {
      expect(approval.rejected_candidates.map((candidate) => candidate.reason)).toEqual([
        "amount_missing",
        "resource_missing",
        "method_missing",
        "network_missing",
        "asset_missing",
        "payee_missing",
        "scheme_missing",
        "timeout_missing"
      ]);
    }
  });

  it("validates the canonical Casper payment payload before paid retry", () => {
    const valid = validateX402PaymentPayload(validSignedPayload("a".repeat(64)), "a".repeat(64));
    const mismatched = validateX402PaymentPayload(
      validSignedPayload("b".repeat(64)),
      "a".repeat(64)
    );

    expect(valid.approved).toBe(true);
    expect(mismatched).toEqual({
      approved: false,
      reason: "selected_requirement_hash_mismatch"
    });
  });

  it("does not treat facilitator verify output as settlement", () => {
    const verifyOnly = verifyX402SettlementResponse({ valid: true });
    const settleWithoutHash = verifyX402SettlementResponse({ success: true });
    const settled = verifyX402SettlementResponse(validPaymentResponse("hash-abc123"));

    expect(verifyOnly.settled).toBe(false);
    expect(settleWithoutHash.settled).toBe(false);
    expect(settled.settled).toBe(true);
    if (settled.settled) {
      expect(settled.transaction_hash).toBe("hash-abc123");
      expect(settled.receipt_json).toContain("transactionHash");
    }
  });

  it("keeps settlement unavailable when the settlement provider is disabled", async () => {
    const provider = new DisabledX402SettlementProvider();

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: {
        scheme: "exact",
        resource: "http://localhost:4021/weather",
        privateKey: "must-not-leak"
      },
      selected_requirement_hash: "a".repeat(64),
      policy_hash: "policy-hash"
    });

    expect(result.status).toBe("unavailable");
    expect(result.blocker).toBe("x402_settlement_disabled");
    expect(result.signed_payload_hash).toBeNull();
    expect(result.receipt_json).toContain("settlement_unavailable");
    expect(result.receipt_json).not.toContain("must-not-leak");
  });

  it("requests signed x402 payloads from an external signer", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const signedPayload = validSignedPayload(selectedRequirementHash);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer signer-token");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.payment_id).toBe("pay_demo");
      expect(body.selected_requirement_hash).toBe(selectedRequirementHash);

      return new Response(JSON.stringify({ signed_payload: signedPayload }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new HttpX402SigningProvider({
      signerUrl: "http://localhost:4030/sign",
      authToken: "signer-token",
      timeoutMs: 1000
    });

    const result = await provider.sign({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validRequirement(),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(result.signed).toBe(true);
    if (result.signed) {
      expect(result.signed_payload).toEqual(signedPayload);
      expect(result.signed_payload_hash).toBe(createSignedPayloadHash(signedPayload));
    }
  });

  it("returns unavailable when the external signer cannot provide a payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "signer_down" }), { status: 500 }))
    );
    const provider = new HttpX402SigningProvider({
      signerUrl: "http://localhost:4030/sign",
      timeoutMs: 1000
    });

    const result = await provider.sign({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validRequirement(),
      selected_requirement_hash: "a".repeat(64),
      policy_hash: "policy-hash"
    });

    expect(result).toEqual({
      signed: false,
      blocker: "x402_signer_request_failed"
    });
  });

  it("retries the paid resource and verifies PAYMENT-RESPONSE before settlement", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const signedPayload = validSignedPayload(selectedRequirementHash);
    const paymentResponse = validPaymentResponse("d".repeat(64));
    const provider = new ResourceRetryX402SettlementProvider(
      {
        async sign() {
          return {
            signed: true,
            signed_payload: signedPayload,
            signed_payload_hash: createSignedPayloadHash(signedPayload)
          };
        }
      },
      async (_url, init) => {
        expect(init.method).toBe("GET");
        const header = init.headers["PAYMENT-SIGNATURE"];
        expect(header).toBeTruthy();
        expect(JSON.parse(Buffer.from(header!, "base64").toString("utf8"))).toEqual(
          signedPayload
        );

        return {
          status: 200,
          headers: new Headers({
            "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(paymentResponse), "utf8").toString(
              "base64"
            )
          }),
          bodyText: JSON.stringify({ weather: "sunny" })
        };
      }
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validRequirement(),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(result.status).toBe("settled");
    if (result.status === "settled") {
      expect(result.casper_transaction_hash).toBe("d".repeat(64));
      expect(result.signed_payload_hash).toBe(createSignedPayloadHash(signedPayload));
      expect(result.receipt_json).toContain("resource_response_hash");
      expect(result.receipt_json).not.toContain("signature-local-demo");
    }
  });

  it("does not settle a paid resource response without PAYMENT-RESPONSE proof", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const signedPayload = validSignedPayload(selectedRequirementHash);
    const provider = new ResourceRetryX402SettlementProvider(
      {
        async sign() {
          return {
            signed: true,
            signed_payload: signedPayload,
            signed_payload_hash: createSignedPayloadHash(signedPayload)
          };
        }
      },
      async () => ({
        status: 200,
        headers: new Headers(),
        bodyText: JSON.stringify({ weather: "sunny" })
      })
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validRequirement(),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.blocker).toBe("x402_paid_resource_settlement_not_verified");
      expect(result.casper_transaction_hash).toBeNull();
    }
  });

  it("builds a native CSPR Casper x402 transfer transaction", () => {
    const invocation = buildCasperX402SettlementCommand(
      casperCliConfig(),
      casperSettlementPayment()
    );

    expect(invocation.command).toBe("casper-client");
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "put-transaction",
        "transfer",
        "--node-address",
        "https://node.test/rpc",
        "--chain-name",
        "casper-test",
        "--target",
        `02${"2".repeat(66)}`,
        "--transfer-amount",
        "2500000000",
        "--payment-amount",
        "7000000000",
        "--standard-payment",
        "true",
        "--secret-key",
        "./keys/facilitator.pem"
      ])
    );
    expect(invocation.args).not.toContain("--transfer-id");
  });

  it("submits Casper settlement and waits for successful execution before settling", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const transactionHash = "d".repeat(64);
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const provider = new CasperCliX402SettlementProvider(
      {
        async sign() {
          const payload = validCasperSignedPayload(selectedRequirementHash);
          return {
            signed: true,
            signed_payload: payload,
            signed_payload_hash: createSignedPayloadHash(payload)
          };
        }
      },
      casperCliConfig(),
      async (command, args) => {
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
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validCasperRequirement(selectedRequirementHash),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(calls.map((call) => call.args[0])).toEqual(["put-transaction", "get-transaction"]);
    expect(result.status).toBe("settled");
    if (result.status === "settled") {
      expect(result.casper_transaction_hash).toBe(transactionHash);
      expect(result.receipt_json).toContain("transactionHash");
      expect(result.receipt_json).toContain("casper-native-cspr");
      expect(result.receipt_json).not.toContain("signature-local-demo");
    }
  });

  it("returns an explicit blocker when Casper CLI submission fails", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const provider = new CasperCliX402SettlementProvider(
      {
        async sign() {
          const payload = validCasperSignedPayload(selectedRequirementHash);
          return {
            signed: true,
            signed_payload: payload,
            signed_payload_hash: createSignedPayloadHash(payload)
          };
        }
      },
      casperCliConfig(),
      async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "node rejected transaction"
      })
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validCasperRequirement(selectedRequirementHash),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.blocker).toBe("x402_casper_transaction_submission_failed");
      expect(result.casper_transaction_hash).toBeNull();
    }
  });

  it("rejects Casper settlement when get-transaction reports failed execution", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const transactionHash = "e".repeat(64);
    const provider = new CasperCliX402SettlementProvider(
      {
        async sign() {
          const payload = validCasperSignedPayload(selectedRequirementHash);
          return {
            signed: true,
            signed_payload: payload,
            signed_payload_hash: createSignedPayloadHash(payload)
          };
        }
      },
      casperCliConfig(),
      async (_command, args) =>
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
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validCasperRequirement(selectedRequirementHash),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.blocker).toBe("x402_casper_transaction_execution_failed");
      expect(result.casper_transaction_hash).toBe(transactionHash);
    }
  });

  it("parses Casper get-transaction execution status", () => {
    expect(
      verifyCasperTransactionExecution({
        exitCode: 0,
        stdout: JSON.stringify({ result: { execution_info: [{ error_message: null }] } }),
        stderr: ""
      })
    ).toMatchObject({ status: "success" });
    expect(
      verifyCasperTransactionExecution({
        exitCode: 0,
        stdout: JSON.stringify({ result: { execution_info: [{ error_message: "revert" }] } }),
        stderr: ""
      })
    ).toMatchObject({ status: "failed", errorMessage: "revert" });
    expect(
      verifyCasperTransactionExecution({
        exitCode: 0,
        stdout: JSON.stringify({ result: { transaction: {} } }),
        stderr: ""
      })
    ).toMatchObject({ status: "not_executed" });
  });

  it("calls facilitator verify before settle and persists only verified settlement", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const signedPayload = validSignedPayload(selectedRequirementHash);
    const calls: string[] = [];
    const provider = new FacilitatorX402SettlementProvider(
      {
        async sign() {
          return {
            signed: true,
            signed_payload: signedPayload,
            signed_payload_hash: createSignedPayloadHash(signedPayload)
          };
        }
      },
      async (url) => {
        calls.push(url);
        if (url.endsWith("/verify")) {
          return { status: 200, body: { valid: true } };
        }

        return {
          status: 200,
          body: validPaymentResponse("f".repeat(64))
        };
      }
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validRequirement(),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(calls).toEqual(["http://localhost:4022/verify", "http://localhost:4022/settle"]);
    expect(result.status).toBe("settled");
    if (result.status === "settled") {
      expect(result.casper_transaction_hash).toBe("f".repeat(64));
      expect(result.signed_payload_hash).toBe(createSignedPayloadHash(signedPayload));
    }
  });

  it("returns failed settlement when facilitator verification fails", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const provider = new FacilitatorX402SettlementProvider(
      {
        async sign() {
          const payload = validSignedPayload(selectedRequirementHash);
          return {
            signed: true,
            signed_payload: payload,
            signed_payload_hash: createSignedPayloadHash(payload)
          };
        }
      },
      async () => ({
        status: 502,
        body: { valid: false, error: "facilitator_down" }
      })
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validRequirement(),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.blocker).toBe("x402_facilitator_verify_failed");
      expect(result.casper_transaction_hash).toBeNull();
    }
  });

  it("does not treat facilitator verify success as settlement", async () => {
    const selectedRequirementHash = "a".repeat(64);
    const provider = new FacilitatorX402SettlementProvider(
      {
        async sign() {
          const payload = validSignedPayload(selectedRequirementHash);
          return {
            signed: true,
            signed_payload: payload,
            signed_payload_hash: createSignedPayloadHash(payload)
          };
        }
      },
      async (url) =>
        url.endsWith("/verify")
          ? { status: 200, body: { valid: true } }
          : { status: 200, body: { valid: true } }
    );

    const result = await provider.settle({
      payment_id: "pay_demo",
      facilitator_url: "http://localhost:4022",
      method: "GET",
      url: "http://localhost:4021/weather",
      selected_requirement: validRequirement(),
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: "policy-hash"
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.blocker).toBe("x402_facilitator_settlement_not_verified");
      expect(result.casper_transaction_hash).toBeNull();
    }
  });
});

function createPolicy(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  const now = new Date("2026-06-05T00:00:00.000Z").toISOString();

  return {
    agent_id: "agent-demo-1",
    policy_id: "pol-demo",
    enabled: true,
    allowed_urls: ["http://localhost:4021/weather"],
    allowed_methods: ["GET"],
    allowed_asset: { caip2_chain_id: "casper:casper-test" },
    max_amount_per_call: "0.05",
    max_amount_per_period: "1.00",
    period_seconds: 86400,
    secret_scopes: ["x402:sign"],
    policy_hash: "policy-hash",
    current_period_spend: "0",
    period_started_at: now,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

function validRequirement(): JsonObject {
  return {
    scheme: "exact",
    network: "casper:casper-test",
    maxAmountRequired: "0.01",
    amount: "0.01",
    resource: "http://localhost:4021/weather",
    method: "GET",
    asset: "asset-package-hash",
    payTo: "casper-payee",
    maxTimeoutSeconds: 60
  };
}

function validSignedPayload(selectedRequirementHash: string): JsonObject {
  return {
    x402Version: 2,
    scheme: "exact",
    network: "casper:casper-test",
    payer: "account-hash-casper-payer",
    nonce: "nonce-demo-001",
    validAfter: "2026-06-05T00:00:00.000Z",
    validUntil: "2026-06-05T00:01:00.000Z",
    selectedRequirementHash,
    authorization: {
      type: "casper-signature",
      publicKey: "01".repeat(32),
      signature: "signature-local-demo"
    }
  };
}

function validPaymentResponse(transactionHash: string): JsonObject {
  return {
    success: true,
    transactionHash,
    network: "casper:casper-test",
    asset: "asset-package-hash",
    amount: "0.01",
    payer: "account-hash-casper-payer",
    payTo: "casper-payee"
  };
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

function casperSettlementPayment() {
  return {
    settlementKind: "native-transfer" as const,
    scheme: "exact" as const,
    network: "casper:casper-test",
    assetId: "casper-native-cspr" as const,
    target: `02${"2".repeat(66)}`,
    amount: "2500000000",
    nonce: "a".repeat(64)
  };
}

function validCasperRequirement(selectedRequirementHash: string): JsonObject {
  return {
    scheme: "exact",
    network: "casper:casper-test",
    maxAmountRequired: "2500000000",
    amount: "2500000000",
    resource: "http://localhost:4021/weather",
    method: "GET",
    asset: "casper-native-cspr",
    payTo: `02${"2".repeat(66)}`,
    maxTimeoutSeconds: 900,
    selectedRequirementHash
  };
}

function validCasperSignedPayload(selectedRequirementHash: string): JsonObject {
  const payment = casperSettlementPayment();

  return {
    x402Version: 2,
    scheme: "exact",
    network: payment.network,
    payer: "account-hash-1111111111111111111111111111111111111111111111111111111111111111",
    nonce: payment.nonce,
    validAfter: "2026-06-05T00:00:00.000Z",
    validUntil: "2026-06-05T00:15:00.000Z",
    selectedRequirementHash,
    authorization: {
      type: "casper-native-transfer",
      signature: "signature-local-demo"
    }
  };
}

function withoutKey(
  value: Record<string, unknown>,
  ...keys: string[]
): JsonObject {
  const copy = { ...value };
  for (const key of keys) {
    delete copy[key];
  }

  return copy as JsonObject;
}
