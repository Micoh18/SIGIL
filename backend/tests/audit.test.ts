import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditService } from "../src/audit/service.js";
import { FileAuditStore } from "../src/audit/store.js";

describe("AuditService", () => {
  it("persists audit events and tails newest first with a limit", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-audit-"));
    const audit = new AuditService(new FileAuditStore(dataDir));

    const first = await audit.record({
      agent_id: "agent-demo-1",
      event_type: "memory.created",
      subject_type: "memory",
      subject_id: "mem_1",
      severity: "info",
      metadata: { content_hash: "abc" }
    });

    await audit.record({
      agent_id: "agent-demo-1",
      event_type: "payment.policy_approved",
      subject_type: "payment",
      subject_id: "pay_1",
      severity: "info",
      metadata: { policy_id: "pol-demo" }
    });

    const tail = await audit.tail({ agent_id: "agent-demo-1", limit: 1 });

    expect(first.id).toMatch(/^aud_/);
    expect(tail.count).toBe(1);
    expect(tail.events[0]?.event_type).toBe("payment.policy_approved");
    expect(JSON.stringify(tail.events)).not.toContain("super-secret-value");
  });

  it("records service events for memory, grimoire, and payment preflight", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-audit-flow-"));
    const audit = new AuditService(new FileAuditStore(dataDir));

    const { MemoryService } = await import("../src/memory/service.js");
    const { FileMemoryStore } = await import("../src/memory/store.js");
    const { GrimoireService } = await import("../src/grimoire/service.js");
    const { FileGrimoireStore } = await import("../src/grimoire/store.js");
    const { PaymentService } = await import("../src/payments/service.js");
    const { FilePaymentStore } = await import("../src/payments/store.js");

    const memory = new MemoryService(new FileMemoryStore(dataDir), audit);
    const grimoire = new GrimoireService(new FileGrimoireStore(dataDir), Buffer.alloc(32, 1), audit);
    const payments = new PaymentService(grimoire, new FilePaymentStore(dataDir), audit);

    await memory.write({
      agent_id: "agent-demo-1",
      type: "observation",
      source: { kind: "test" },
      body: { note: "audit me" }
    });
    await grimoire.putSecret({
      agent_id: "agent-demo-1",
      name: "demo-key",
      type: "api_key",
      value: "super-secret-value",
      scopes: ["api:read"]
    });
    await grimoire.listSecrets("agent-demo-1");
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
    await grimoire.getPolicy("agent-demo-1", "pol-demo");
    await payments.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      idempotency_key: "idem-1"
    });

    const eventTypes = (await audit.tail({ agent_id: "agent-demo-1", limit: 20 })).events.map(
      (event) => event.event_type
    );

    expect(eventTypes).toContain("memory.created");
    expect(eventTypes).toContain("secret.stored");
    expect(eventTypes).toContain("secret.listed");
    expect(eventTypes).toContain("policy.set");
    expect(eventTypes).toContain("policy.get");
    expect(eventTypes).toContain("payment.policy_approved");
  });
});
