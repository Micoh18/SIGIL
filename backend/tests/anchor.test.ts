import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockCasperAnchorClient } from "../src/casper/anchorClient.js";
import { MemoryService } from "../src/memory/service.js";
import { FileMemoryStore } from "../src/memory/store.js";

describe("Casper anchor foundation", () => {
  it("routes anchored memory writes through the Casper anchor client interface", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-anchor-"));
    const anchorClient = new MockCasperAnchorClient();
    const memory = new MemoryService(new FileMemoryStore(dataDir), undefined, anchorClient);

    const written = await memory.write({
      agent_id: "agent-demo-1",
      type: "observation",
      source: { kind: "test" },
      body: { note: "anchor me" },
      anchor: true
    });

    expect(anchorClient.submissions).toHaveLength(1);
    expect(anchorClient.submissions[0]?.content_hash).toBe(written.content_hash);
    expect(written.anchor_status).toBe("pending");
    expect(written.anchor_id).toMatch(/^[a-f0-9]{64}$/);
    expect(written.casper_transaction_hash).toBeNull();
  });

  it("includes local anchor metadata in memory verification", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-anchor-"));
    const memory = new MemoryService(
      new FileMemoryStore(dataDir),
      undefined,
      new MockCasperAnchorClient()
    );

    const written = await memory.write({
      agent_id: "agent-demo-1",
      type: "observation",
      body: { note: "verify anchor metadata" },
      anchor: true
    });
    const verification = await memory.verify("agent-demo-1", written.memory_id);

    expect(verification.valid).toBe(true);
    expect(verification.anchor_id).toBe(written.anchor_id);
    expect(verification.onchain_content_hash).toBeNull();
    expect(verification.casper_transaction_hash).toBeNull();
  });
});
