import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GrimoireService } from "../src/grimoire/service.js";
import { FileGrimoireStore } from "../src/grimoire/store.js";
import { PaymentService } from "../src/payments/service.js";
import { FilePaymentStore } from "../src/payments/store.js";

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
    expect(result.next_state).toBe("ready_for_x402_challenge");
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

async function createService(): Promise<{ service: PaymentService; dataDir: string }> {
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

  return { service: new PaymentService(grimoire, new FilePaymentStore(dataDir)), dataDir };
}
