import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "../src/memory/canonical.js";
import { MemoryService } from "../src/memory/service.js";
import { FileMemoryStore } from "../src/memory/store.js";

describe("canonicalizeJson", () => {
  it("sorts object keys deterministically", () => {
    const left = canonicalizeJson({ b: 2, a: { d: 4, c: 3 } });
    const right = canonicalizeJson({ a: { c: 3, d: 4 }, b: 2 });

    expect(left).toBe(right);
  });
});

describe("MemoryService", () => {
  it("writes, reads, searches, and verifies local memory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-memory-"));
    const service = new MemoryService(new FileMemoryStore(dataDir));

    const written = await service.write({
      agent_id: "agent-demo-1",
      type: "observation",
      source: { kind: "test" },
      body: { note: "paid weather response" },
      anchor: true
    });

    const read = await service.read("agent-demo-1", written.memory_id);
    const search = await service.search("agent-demo-1", "weather");
    const verification = await service.verify("agent-demo-1", written.memory_id);

    expect(read?.content_hash).toBe(written.content_hash);
    expect(search.count).toBe(1);
    expect(verification.valid).toBe(true);
    expect(verification.anchor_status).toBe("pending");
  });

  it("accepts text notes and finds memories with natural-language token search", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-memory-"));
    const service = new MemoryService(new FileMemoryStore(dataDir));

    const written = await service.write({
      agent_id: "agent-demo-1",
      type: "decision",
      source: "User stated a durable live-demo communication preference.",
      body: {
        preference:
          "Use plain English, avoid tool jargon, and make evidence-backed claims only."
      }
    });

    const read = await service.read("agent-demo-1", written.memory_id);
    const search = await service.search(
      "agent-demo-1",
      "Have I said anything before about avoiding tool jargon?"
    );

    expect(read?.source).toEqual({
      note: "User stated a durable live-demo communication preference."
    });
    expect(written.anchor_status).toBe("not_requested");
    expect(search.count).toBe(1);
    expect(search.results[0]?.memory_id).toBe(written.memory_id);
  });
});
