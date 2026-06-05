import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { PolicyRecord } from "../src/grimoire/types.js";
import { X402ChallengeClient } from "../src/x402/client.js";
import { approveX402Requirements, verifyX402SettlementResponse } from "../src/x402/readiness.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("x402 foundation", () => {
  it("loads Casper x402 configuration from environment", () => {
    const config = loadConfig({
      X402_FACILITATOR_URL: "http://localhost:4022",
      X402_RESOURCE_DEMO_URL: "http://localhost:4021/weather",
      X402_ASSET_PACKAGE: "asset-package-hash",
      CASPER_CAIP2_CHAIN_ID: "casper:casper-test"
    });

    expect(config.x402.facilitatorUrl).toBe("http://localhost:4022");
    expect(config.x402.resourceDemoUrl).toBe("http://localhost:4021/weather");
    expect(config.x402.assetPackage).toBe("asset-package-hash");
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
                network: "casper-test",
                maxAmountRequired: "0.01",
                resource: "weather",
                asset: "asset-package-hash",
                payTo: "casper-payee"
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
          network: "casper-test",
          maxAmountRequired: "0.01",
          asset: "asset-package-hash",
          payTo: "casper-payee"
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
            scheme: "exact",
            network: "casper-test",
            maxAmountRequired: "0.01",
            resource: "http://localhost:4021/weather",
            asset: "asset-package-hash",
            payTo: "casper-payee"
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
            scheme: "exact",
            network: "casper-test",
            maxAmountRequired: "0.02",
            resource: "http://localhost:4021/weather",
            asset: "asset-package-hash",
            payTo: "casper-payee"
          },
          {
            scheme: "exact",
            network: "casper-test",
            maxAmountRequired: "0.01",
            resource: "http://localhost:4021/other",
            asset: "asset-package-hash",
            payTo: "casper-payee"
          },
          {
            scheme: "exact",
            network: "casper-test",
            maxAmountRequired: "0.01",
            resource: "http://localhost:4021/weather",
            asset: "other-asset",
            payTo: "casper-payee"
          },
          {
            scheme: "exact",
            network: "casper-test",
            maxAmountRequired: "0.01",
            resource: "http://localhost:4021/weather",
            asset: "asset-package-hash",
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

  it("does not treat facilitator verify output as settlement", () => {
    const verifyOnly = verifyX402SettlementResponse({ valid: true });
    const settleWithoutHash = verifyX402SettlementResponse({ success: true });
    const settled = verifyX402SettlementResponse({
      success: true,
      transactionHash: "hash-abc123"
    });

    expect(verifyOnly.settled).toBe(false);
    expect(settleWithoutHash.settled).toBe(false);
    expect(settled.settled).toBe(true);
    if (settled.settled) {
      expect(settled.transaction_hash).toBe("hash-abc123");
      expect(settled.receipt_json).toContain("transactionHash");
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
