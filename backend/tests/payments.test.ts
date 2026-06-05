import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GrimoireService } from "../src/grimoire/service.js";
import { FileGrimoireStore } from "../src/grimoire/store.js";
import { PaymentService } from "../src/payments/service.js";

describe("PaymentService", () => {
  it("allows a fetch preflight when policy matches", async () => {
    const service = await createService();

    const result = await service.preflightFetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "get",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01"
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("policy_checked");
    expect(result.method).toBe("GET");
  });

  it("denies a fetch preflight over the per-call limit", async () => {
    const service = await createService();

    const result = await service.preflightFetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.06"
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("policy_denied");
    expect(result.reason).toBe("amount_over_limit");
  });
});

async function createService(): Promise<PaymentService> {
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

  return new PaymentService(grimoire);
}

