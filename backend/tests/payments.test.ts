import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrimoireService } from "../src/grimoire/service.js";
import { FileGrimoireStore } from "../src/grimoire/store.js";
import { PaymentService } from "../src/payments/service.js";
import { FilePaymentStore } from "../src/payments/store.js";
import { X402ChallengeClient } from "../src/x402/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaymentService", () => {
  it("allows and persists a fetch preflight when policy matches", async () => {
    const { service, dataDir } = await createService();

    const result = await service.preflightFetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "get",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "weather-1"
    });

    const rawStore = await readFile(join(dataDir, "payments.json"), "utf8");

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("policy_checked");
    expect(result.method).toBe("GET");
    expect(result.persisted).toBe(true);
    expect(result.next_state).toBe("challenge_received");
    expect(result.requirements_json).toBeNull();
    expect(rawStore).toContain(result.payment_id);
  });

  it("denies and persists a fetch preflight over the per-call limit", async () => {
    const { service, dataDir } = await createService();

    const result = await service.preflightFetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.06"
    });

    const rawStore = await readFile(join(dataDir, "payments.json"), "utf8");

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("policy_denied");
    expect(result.reason).toBe("amount_over_limit");
    expect(result.persisted).toBe(true);
    expect(rawStore).toContain("policy_denied");
  });

  it("reuses the same payment intent for the same idempotency key", async () => {
    const { service } = await createService();

    const first = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "same-fetch"
    });
    const second = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "same-fetch"
    });

    expect(first.payment_id).toBe(second.payment_id);
  });

  it("captures and persists a 402 challenge after policy approval", async () => {
    const requirements = {
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
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(requirements), {
          status: 402,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const { service, dataDir } = await createService({ withChallengeClient: true });

    const result = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "challenge-1",
      request_challenge: true
    });
    if (!result.allowed) {
      throw new Error("Expected payment fetch to be policy-approved");
    }
    const receipt = await service.receipt(result.payment_id);
    const rawStore = await readFile(join(dataDir, "payments.json"), "utf8");

    expect(result.status).toBe("challenge_received");
    expect(result.settlement).toBe("not_started");
    expect(result.settlement_blocker).toBe("signed_payload_not_implemented");
    expect(result.requirements).toMatchObject({ x402Version: 1 });
    expect(result.challenge?.status).toBe("payment_required");
    expect(result.challenge?.requirements_source).toBe("json-body");
    expect(receipt.intent?.status).toBe("challenge_received");
    expect(receipt.intent?.requirements_json).toContain("x402Version");
    expect(rawStore).toContain("\"requirements_json\"");
    expect(rawStore).toContain("asset-package-hash");
  });

  it("keeps captured challenge requirements durable across service instances", async () => {
    const requirements = {
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
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(requirements), {
          status: 402,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const { service, dataDir } = await createService({ withChallengeClient: true });

    const result = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "durable-challenge",
      request_challenge: true
    });
    const restartedService = new PaymentService(
      new GrimoireService(new FileGrimoireStore(dataDir), Buffer.alloc(32, 1)),
      new FilePaymentStore(dataDir)
    );
    const receipt = await restartedService.receipt(result.payment_id);

    expect(receipt.found).toBe(true);
    expect(receipt.intent?.status).toBe("challenge_received");
    expect(receipt.intent?.requirements_json).toContain("asset-package-hash");
    expect(receipt.intent?.signed_payload_hash).toBeNull();
    expect(receipt.receipt).toBeNull();
  });

  it("rejects unexpected payment requirements before any signed payload exists", async () => {
    const requirements = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "casper-test",
          maxAmountRequired: "0.02",
          resource: "http://localhost:4021/weather",
          asset: "asset-package-hash",
          payTo: "casper-payee"
        }
      ]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(requirements), {
          status: 402,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const { service } = await createService({ withChallengeClient: true });

    const result = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      request_challenge: true
    });
    if (!result.allowed) {
      throw new Error("Expected payment fetch to pass policy before requirement rejection");
    }
    const receipt = await service.receipt(result.payment_id);

    expect(result.status).toBe("settlement_unavailable");
    expect(result.settlement).toBe("unavailable");
    expect(result.settlement_blocker).toBe("x402_requirements_not_allowed");
    expect(result.requirements_json).toContain("maxAmountRequired");
    expect(receipt.intent?.requirements_json).toContain("0.02");
    expect(receipt.intent?.signed_payload_hash).toBeNull();
    expect(receipt.intent?.settlement_blocker).toBe("x402_requirements_not_allowed");
    expect(receipt.intent?.status).not.toBe("settled");
    expect(receipt.receipt).toBeNull();
  });

  it("does not claim settlement when the resource is free", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ weather: "sunny" }), { status: 200 }))
    );
    const { service } = await createService({ withChallengeClient: true });

    const result = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      request_challenge: true
    });
    if (!result.allowed) {
      throw new Error("Expected payment fetch to be policy-approved");
    }
    const receipt = await service.receipt(result.payment_id);

    expect(result.status).toBe("policy_checked");
    expect(result.settlement).toBe("not_required");
    expect(result.challenge?.status).toBe("free_response");
    expect(result.challenge?.response_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.intent?.status).toBe("policy_checked");
    expect(receipt.intent?.status).not.toBe("settled");
    expect(receipt.receipt).toBeNull();
  });

  it("records settlement_unavailable for an unexpected resource response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );
    const { service } = await createService({ withChallengeClient: true });

    const result = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      request_challenge: true
    });
    if (!result.allowed) {
      throw new Error("Expected payment fetch to be policy-approved");
    }
    const receipt = await service.receipt(result.payment_id);

    expect(result.status).toBe("settlement_unavailable");
    expect(result.settlement).toBe("unavailable");
    expect(result.settlement_blocker).toBe("x402_unexpected_resource_response");
    expect(result.challenge?.status).toBe("unexpected_response");
    expect(result.challenge?.response_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.intent?.status).toBe("settlement_unavailable");
    expect(receipt.intent?.status).not.toBe("settled");
  });

  it("returns the same persisted challenge intent for an idempotent call", async () => {
    const requirements = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "casper-test",
          maxAmountRequired: "0.01",
          resource: "http://localhost:4021/weather"
        }
      ]
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(requirements), {
          status: 402,
          headers: { "content-type": "application/json" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { service } = await createService({ withChallengeClient: true });

    const first = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "same-challenge",
      request_challenge: true
    });
    const second = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "same-challenge",
      request_challenge: true
    });

    expect(first.payment_id).toBe(second.payment_id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.allowed && first.status).toBe("challenge_received");
    expect(second.allowed && second.status).toBe("challenge_received");
    expect(second.allowed && second.requirements_json).toContain("x402Version");
  });

  it("returns a durable payment receipt view even before settlement exists", async () => {
    const { service } = await createService();

    const result = await service.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01"
    });
    const receipt = await service.receipt(result.payment_id);

    expect(receipt.found).toBe(true);
    expect(receipt.intent?.status).toBe("policy_checked");
    expect(receipt.receipt).toBeNull();
  });
});

async function createService(
  options: { withChallengeClient?: boolean } = {}
): Promise<{ service: PaymentService; dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "sigil-payments-"));
  const grimoire = new GrimoireService(new FileGrimoireStore(dataDir), Buffer.alloc(32, 1));

  await grimoire.setPolicy({
    agent_id: "agent-demo-1",
    policy_id: "pol-demo",
    allowed_urls: ["http://localhost:4021/weather"],
    allowed_methods: ["GET"],
    allowed_asset: { caip2_chain_id: "casper:casper-test" },
    max_amount_per_call: "0.05",
    max_amount_per_period: "1.00",
    period_seconds: 86400,
    secret_scopes: ["x402:sign"]
  });

  return {
    service: new PaymentService(
      grimoire,
      new FilePaymentStore(dataDir),
      undefined,
      options.withChallengeClient
        ? new X402ChallengeClient({
            facilitatorUrl: "http://localhost:4022",
            resourceUrl: "http://localhost:4021/weather"
          })
        : undefined
    ),
    dataDir
  };
}
