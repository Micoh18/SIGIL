import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GrimoireService } from "../src/grimoire/service.js";
import { FileGrimoireStore } from "../src/grimoire/store.js";

describe("GrimoireService", () => {
  it("stores secret metadata without exposing plaintext", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-grimoire-"));
    const service = new GrimoireService(new FileGrimoireStore(dataDir), Buffer.alloc(32, 1));

    const secret = await service.putSecret({
      agent_id: "agent-demo-1",
      name: "x402-demo-key",
      type: "x402_client_key_ref",
      value: "super-secret-value",
      scopes: ["x402:sign"]
    });

    const secrets = await service.listSecrets("agent-demo-1");
    const rawStore = await readFile(join(dataDir, "grimoire.json"), "utf8");

    expect(secret.name).toBe("x402-demo-key");
    expect(secrets).toHaveLength(1);
    expect(JSON.stringify(secrets)).not.toContain("super-secret-value");
    expect(rawStore).not.toContain("super-secret-value");
  });

  it("creates stable policy hashes for equivalent input", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-grimoire-"));
    const service = new GrimoireService(new FileGrimoireStore(dataDir), Buffer.alloc(32, 1));

    const first = await service.setPolicy({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      allowed_urls: ["http://localhost:4021/weather"],
      allowed_methods: ["get"],
      allowed_asset: { caip2_chain_id: "casper:casper-test" },
      max_amount_per_call: "0.05",
      max_amount_per_period: "1.00",
      period_seconds: 86400,
      secret_scopes: ["x402:sign"]
    });

    const second = await service.setPolicy({
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

    expect(first.policy_hash).toBe(second.policy_hash);
    expect(second.allowed_methods).toEqual(["GET"]);
  });

  it("normalizes GET to POST for hosted payment action endpoints", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-grimoire-"));
    const service = new GrimoireService(new FileGrimoireStore(dataDir), Buffer.alloc(32, 1));

    const policy = await service.setPolicy({
      agent_id: "agent-demo-1",
      policy_id: "pol-hosted-x402",
      allowed_urls: ["https://mainspring-x402-demo-api.onrender.com/demo/x402/payment-fetch"],
      allowed_methods: ["get"],
      allowed_asset: { caip2_chain_id: "casper:casper-test" },
      max_amount_per_call: "2.5",
      max_amount_per_period: "10",
      period_seconds: 86400,
      secret_scopes: ["casper:testnet", "payment:sign"]
    });

    expect(policy.allowed_methods).toEqual(["POST"]);
  });
});
