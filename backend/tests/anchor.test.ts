import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfiguredCasperAnchorClient,
  computeAnchorId,
  createAnchorSubmission,
  createCasperAnchorClient,
  MockCasperAnchorClient,
  REAL_CASPER_ANCHOR_ENV_VARS
} from "../src/casper/anchorClient.js";
import { loadConfig } from "../src/config.js";
import { sha256Hex } from "../src/memory/hash.js";
import { MemoryService } from "../src/memory/service.js";
import { FileMemoryStore } from "../src/memory/store.js";

const hex64 = /^[a-f0-9]{64}$/;

describe("Casper anchor foundation", () => {
  it("computes a deterministic anchor id and hash-only anchor submission", () => {
    const request = {
      agent_id: "agent-demo-1",
      memory_id: "mem_demo_1",
      content_hash: "a".repeat(64),
      metadata_hash: "b".repeat(64),
      prev_anchor_hash: "c".repeat(64)
    };

    const submission = createAnchorSubmission(request);

    expect(submission.anchor_id).toBe(computeAnchorId(request));
    expect(submission.anchor_id).toBe(
      sha256Hex(
        [
          request.agent_id,
          request.memory_id,
          request.content_hash,
          request.prev_anchor_hash
        ].join(":")
      )
    );
    expect(submission.agent_id_hash).toBe(sha256Hex(request.agent_id));
    expect(submission.memory_id_hash).toBe(sha256Hex(request.memory_id));
    expect(Object.keys(submission).sort()).toEqual(
      [
        "agent_id_hash",
        "anchor_id",
        "content_hash",
        "memory_id_hash",
        "metadata_hash",
        "prev_anchor_hash"
      ].sort()
    );
  });

  it("validates configured and unconfigured Casper anchor client behavior", async () => {
    const submission = createAnchorSubmission({
      agent_id: "agent-demo-1",
      memory_id: "mem_demo_1",
      content_hash: "a".repeat(64),
      metadata_hash: "b".repeat(64),
      prev_anchor_hash: null
    });
    const unconfigured = createCasperAnchorClient(loadConfig({}).casper);
    const configured = createCasperAnchorClient(
      loadConfig({
        MEMORY_ANCHOR_CONTRACT_HASH: `hash-${"1".repeat(64)}`,
        MEMORY_ANCHOR_PACKAGE_HASH: `hash-${"2".repeat(64)}`,
        CASPER_RPC_URL: "https://node.test/rpc",
        CASPER_ACCOUNT_KEY_PATH: "./keys/backend.pem"
      }).casper
    );

    const unconfiguredResult = await unconfigured.anchorMemory(submission);
    const configuredResult = await configured.anchorMemory(submission);

    expect(unconfigured.mode).toBe("unconfigured");
    expect(unconfiguredResult.status).toBe("pending");
    expect(unconfiguredResult.reason).toBe("casper_contract_not_configured");
    expect(unconfiguredResult.casper_transaction_hash).toBeNull();
    expect(configured.mode).toBe("configured");
    expect(configured).toBeInstanceOf(ConfiguredCasperAnchorClient);
    expect(configured).not.toBeInstanceOf(MockCasperAnchorClient);
    expect(configuredResult.status).toBe("pending");
    expect(configuredResult.reason).toBe("casper_transaction_submission_not_implemented");
    expect(configuredResult.casper_transaction_hash).toBeNull();
  });

  it("documents the required environment boundary for real Casper testnet use", () => {
    expect(REAL_CASPER_ANCHOR_ENV_VARS).toEqual([
      "CASPER_RPC_URL",
      "CASPER_NETWORK_NAME",
      "MEMORY_ANCHOR_CONTRACT_HASH",
      "MEMORY_ANCHOR_PACKAGE_HASH",
      "CASPER_ACCOUNT_KEY_PATH"
    ]);
  });

  it("rejects invalid or partial configured Casper anchor config", () => {
    expect(() =>
      loadConfig({
        MEMORY_ANCHOR_CONTRACT_HASH: "not-a-casper-hash"
      })
    ).toThrow(/MEMORY_ANCHOR_CONTRACT_HASH/);

    expect(() =>
      loadConfig({
        MEMORY_ANCHOR_CONTRACT_HASH: `hash-${"1".repeat(64)}`
      })
    ).toThrow(/MEMORY_ANCHOR_PACKAGE_HASH/);

    expect(() =>
      loadConfig({
        MEMORY_ANCHOR_CONTRACT_HASH: `hash-${"1".repeat(64)}`,
        MEMORY_ANCHOR_PACKAGE_HASH: `hash-${"2".repeat(64)}`
      })
    ).toThrow(/CASPER_RPC_URL/);
  });

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
    const submission = anchorClient.submissions[0];
    expect(submission?.content_hash).toBe(written.content_hash);
    expect(submission?.metadata_hash).toBe(written.metadata_hash);
    expect(submission?.anchor_id).toBe(written.anchor_id);
    expect(submission?.agent_id_hash).toMatch(hex64);
    expect(submission?.memory_id_hash).toMatch(hex64);
    expect(written.anchor_status).toBe("pending");
    expect(written.anchor_id).toMatch(hex64);
    expect(written.casper_transaction_hash).toBeNull();
  });

  it("stores pending anchor metadata without a configured client", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-anchor-"));
    const memory = new MemoryService(new FileMemoryStore(dataDir));

    const written = await memory.write({
      agent_id: "agent-demo-1",
      type: "observation",
      source: { kind: "test" },
      body: { note: "anchor metadata without client" },
      anchor: true
    });
    const rawStore = await readFile(join(dataDir, "memory.json"), "utf8");

    expect(written.anchor_status).toBe("pending");
    expect(written.anchor_id).toMatch(hex64);
    expect(written.casper_transaction_hash).toBeNull();
    expect(written.onchain_content_hash).toBeNull();
    expect(rawStore).toContain(written.anchor_id ?? "");
  });

  it("does not place memory body, secrets, or raw ids in the Casper anchor payload", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-anchor-"));
    const anchorClient = new MockCasperAnchorClient();
    const memory = new MemoryService(new FileMemoryStore(dataDir), undefined, anchorClient);

    const written = await memory.write({
      agent_id: "agent-demo-1",
      memory_id: "mem_sensitive_1",
      type: "observation",
      source: { kind: "secret_test", api_key_name: "weather-key" },
      body: {
        note: "anchor this local body only by hash",
        secret: "super-secret-value"
      },
      anchor: true
    });
    const submission = anchorClient.submissions[0];
    const payloadJson = JSON.stringify(submission);

    expect(submission).toBeDefined();
    expect(payloadJson).not.toContain("anchor this local body only by hash");
    expect(payloadJson).not.toContain("super-secret-value");
    expect(payloadJson).not.toContain("agent-demo-1");
    expect(payloadJson).not.toContain("mem_sensitive_1");
    expect(submission?.content_hash).toBe(written.content_hash);
    expect(submission?.metadata_hash).toBe(written.metadata_hash);
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
