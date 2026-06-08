import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditService } from "../src/audit/service.js";
import { FileAuditStore } from "../src/audit/store.js";
import {
  buildCasperAnchorCommand,
  ConfiguredCasperAnchorClient,
  type CasperCommandRunner,
  computeAnchorId,
  createAnchorSubmission,
  createCasperAnchorClient,
  extractCasperTransactionHash,
  MockCasperAnchorClient,
  REAL_CASPER_ANCHOR_ENV_VARS
} from "../src/casper/anchorClient.js";
import { loadConfig } from "../src/config.js";
import { sha256Hex } from "../src/memory/hash.js";
import { MemoryService } from "../src/memory/service.js";
import { FileMemoryStore } from "../src/memory/store.js";

const hex64 = /^[a-f0-9]{64}$/;
const testConfigEnv = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  CASPER_CLIENT_AUTO_DETECT_WSL: "false",
  ...env
});

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
    const transactionHash = "d".repeat(64);
    const calls: { command: string; args: readonly string[] }[] = [];
    const runner: CasperCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "get-transaction") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            jsonrpc: "2.0",
            result: {
              execution_info: [{ error_message: null }]
            }
          }),
          stderr: ""
        };
      }

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          jsonrpc: "2.0",
          result: {
            transaction_hash: {
              Version1: transactionHash
            }
          }
        }),
        stderr: ""
      };
    };
    const unconfigured = createCasperAnchorClient(loadConfig(testConfigEnv()).casper);
    const configuredConfig = loadConfig(testConfigEnv({
        MEMORY_ANCHOR_CONTRACT_HASH: `hash-${"1".repeat(64)}`,
        MEMORY_ANCHOR_PACKAGE_HASH: `package-${"2".repeat(64)}`,
        CASPER_RPC_URL: "https://node.test/rpc",
        CASPER_ACCOUNT_KEY_PATH: "./keys/backend.pem",
        CASPER_ENABLE_REAL_SUBMISSION: "true"
      })).casper;
    const configured = createCasperAnchorClient(
      configuredConfig,
      { commandRunner: runner }
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
    expect(configuredResult.status).toBe("anchored");
    expect(configuredResult.reason).toBeUndefined();
    expect(configuredResult.casper_transaction_hash).toBe(transactionHash);
    expect(configuredResult.onchain_content_hash).toBe(submission.content_hash);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe(configuredConfig.clientWslDistro ? "wsl" : configuredConfig.clientBin);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "put-transaction",
        "package",
        "--node-address",
        "https://node.test/rpc",
        "--chain-name",
        "casper-test",
        "--contract-package-hash",
        `hash-${"2".repeat(64)}`,
        "--session-entry-point",
        "anchor_memory",
        "--payment-amount",
        "3000000000",
        "--standard-payment",
        "true",
        "--secret-key",
        configuredConfig.accountKeyPath,
        "--session-args-json"
      ])
    );
    expect(
      JSON.parse(
        String(calls[0]?.args[Number(calls[0]?.args.indexOf("--session-args-json")) + 1])
      )
    ).toContainEqual({ name: "prev_anchor_hash", type: "String", value: "" });
  });

  it("keeps configured Casper submission disabled until explicitly enabled", async () => {
    const submission = createAnchorSubmission({
      agent_id: "agent-demo-1",
      memory_id: "mem_demo_1",
      content_hash: "a".repeat(64),
      metadata_hash: "b".repeat(64),
      prev_anchor_hash: null
    });
    const calls: { command: string; args: readonly string[] }[] = [];
    const client = createCasperAnchorClient(
      loadConfig(testConfigEnv({
        MEMORY_ANCHOR_CONTRACT_HASH: `hash-${"1".repeat(64)}`,
        MEMORY_ANCHOR_PACKAGE_HASH: `package-${"2".repeat(64)}`,
        CASPER_RPC_URL: "https://node.test/rpc",
        CASPER_ACCOUNT_KEY_PATH: "./keys/backend.pem"
      })).casper,
      {
        commandRunner: async (command, args) => {
          calls.push({ command, args });
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    );

    await expect(client.anchorMemory(submission)).resolves.toMatchObject({
      status: "pending",
      casper_transaction_hash: null,
      reason: "casper_transaction_submission_disabled"
    });
    expect(calls).toHaveLength(0);
  });

  it("builds a hash-only Casper package transaction command", () => {
    const submission = createAnchorSubmission({
      agent_id: "agent-demo-1",
      memory_id: "mem_demo_1",
      content_hash: "a".repeat(64),
      metadata_hash: "b".repeat(64),
      prev_anchor_hash: "c".repeat(64)
    });
    const invocation = buildCasperAnchorCommand(
      {
        networkName: "casper-test",
        caip2ChainId: "casper:casper-test",
        rpcUrl: "https://node.test/rpc",
        accountKeyPath: "./keys/backend.pem",
        memoryAnchorContractHash: `hash-${"1".repeat(64)}`,
        memoryAnchorPackageHash: `hash-${"2".repeat(64)}`,
        submissionEnabled: true,
        clientBin: "casper-client",
        clientWslDistro: null,
        anchorSubmissionMode: "transaction-package",
        gasPriceTolerance: "10",
        pricingMode: "classic",
        anchorPaymentAmountMotes: "3000000000",
        confirmationPollIntervalMs: 1,
        confirmationTimeoutMs: 1
      },
      submission
    );
    const argsJson = JSON.stringify(invocation.args);

    expect(invocation.command).toBe("casper-client");
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "put-transaction",
        "package",
        "--contract-package-hash",
        `hash-${"2".repeat(64)}`,
        "--payment-amount",
        "3000000000",
        "--standard-payment",
        "true",
        "--session-args-json"
      ])
    );
    const sessionArgsJson = String(
      invocation.args[Number(invocation.args.indexOf("--session-args-json")) + 1]
    );
    expect(JSON.parse(sessionArgsJson)).toEqual([
      { name: "anchor_id", type: "String", value: submission.anchor_id },
      { name: "agent_id_hash", type: "String", value: submission.agent_id_hash },
      { name: "memory_id_hash", type: "String", value: submission.memory_id_hash },
      { name: "content_hash", type: "String", value: submission.content_hash },
      { name: "metadata_hash", type: "String", value: submission.metadata_hash },
      { name: "prev_anchor_hash", type: "String", value: submission.prev_anchor_hash }
    ]);
    expect(argsJson).not.toContain("agent-demo-1");
    expect(argsJson).not.toContain("mem_demo_1");
  });

  it("wraps Casper client invocations through WSL when configured", () => {
    const submission = createAnchorSubmission({
      agent_id: "agent-demo-1",
      memory_id: "mem_demo_1",
      content_hash: "a".repeat(64),
      metadata_hash: "b".repeat(64),
      prev_anchor_hash: null
    });
    const invocation = buildCasperAnchorCommand(
      {
        networkName: "casper-test",
        caip2ChainId: "casper:casper-test",
        rpcUrl: "https://node.test/rpc",
        accountKeyPath: "D:\\project\\keys\\backend.pem",
        memoryAnchorContractHash: `hash-${"1".repeat(64)}`,
        memoryAnchorPackageHash: `package-${"2".repeat(64)}`,
        submissionEnabled: true,
        clientBin: "casper-client",
        clientWslDistro: "Ubuntu",
        anchorSubmissionMode: "transaction-package",
        gasPriceTolerance: "10",
        pricingMode: "classic",
        anchorPaymentAmountMotes: "3000000000",
        confirmationPollIntervalMs: 1,
        confirmationTimeoutMs: 1
      },
      submission
    );

    expect(invocation.command).toBe("wsl");
    expect(invocation.args.slice(0, 5)).toEqual([
      "-d",
      "Ubuntu",
      "--",
      "casper-client",
      "put-transaction"
    ]);
    expect(invocation.args).toEqual(
      expect.arrayContaining(["--secret-key", "/mnt/d/project/keys/backend.pem"])
    );
  });

  it("parses Casper client transaction hashes conservatively", () => {
    expect(
      extractCasperTransactionHash({
        exitCode: 0,
        stdout: JSON.stringify({
          result: {
            transaction_hash: {
              Version1: "ABCDEF".toLowerCase().padEnd(64, "0")
            }
          }
        }),
        stderr: ""
      })
    ).toBe("abcdef".padEnd(64, "0"));
    expect(
      extractCasperTransactionHash({
        exitCode: 0,
        stdout: `deploy_hash: ${"e".repeat(64)}`,
        stderr: ""
      })
    ).toBe("e".repeat(64));
    expect(
      extractCasperTransactionHash({
        exitCode: 0,
        stdout: "completed without a labelled hash",
        stderr: ""
      })
    ).toBeNull();
  });

  it("fails configured Casper submissions without a verified transaction hash", async () => {
    const submission = createAnchorSubmission({
      agent_id: "agent-demo-1",
      memory_id: "mem_demo_1",
      content_hash: "a".repeat(64),
      metadata_hash: "b".repeat(64),
      prev_anchor_hash: null
    });
    const baseConfig = {
      networkName: "casper-test",
      caip2ChainId: "casper:casper-test",
      rpcUrl: "https://node.test/rpc",
      accountKeyPath: "./keys/backend.pem",
      memoryAnchorContractHash: `hash-${"1".repeat(64)}`,
      memoryAnchorPackageHash: `hash-${"2".repeat(64)}`,
      submissionEnabled: true,
      clientBin: "casper-client",
      clientWslDistro: null,
      anchorSubmissionMode: "transaction-package" as const,
      gasPriceTolerance: "10",
      pricingMode: "classic",
      anchorPaymentAmountMotes: "3000000000",
      confirmationPollIntervalMs: 1,
      confirmationTimeoutMs: 1
    };
    const failedClient = new ConfiguredCasperAnchorClient(baseConfig, async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "network error"
    }));
    const missingHashClient = new ConfiguredCasperAnchorClient(baseConfig, async () => ({
      exitCode: 0,
      stdout: "{}",
      stderr: ""
    }));

    await expect(failedClient.anchorMemory(submission)).resolves.toMatchObject({
      status: "failed",
      casper_transaction_hash: null,
      reason: "casper_transaction_submission_failed"
    });
    await expect(missingHashClient.anchorMemory(submission)).resolves.toMatchObject({
      status: "failed",
      casper_transaction_hash: null,
      reason: "casper_transaction_hash_missing"
    });
  });

  it("documents the required environment boundary for real Casper testnet use", () => {
    expect(REAL_CASPER_ANCHOR_ENV_VARS).toEqual([
      "CASPER_RPC_URL",
      "CASPER_NETWORK_NAME",
      "MEMORY_ANCHOR_CONTRACT_HASH",
      "MEMORY_ANCHOR_PACKAGE_HASH",
      "CASPER_ACCOUNT_KEY_PATH",
      "CASPER_ENABLE_REAL_SUBMISSION"
    ]);
  });

  it("rejects invalid or partial configured Casper anchor config", () => {
    expect(() =>
      loadConfig(testConfigEnv({
        MEMORY_ANCHOR_CONTRACT_HASH: "not-a-casper-hash"
      }))
    ).toThrow(/MEMORY_ANCHOR_CONTRACT_HASH/);

    expect(() =>
      loadConfig(testConfigEnv({
        MEMORY_ANCHOR_CONTRACT_HASH: `hash-${"1".repeat(64)}`
      }))
    ).toThrow(/MEMORY_ANCHOR_PACKAGE_HASH/);

    expect(() =>
      loadConfig(testConfigEnv({
        MEMORY_ANCHOR_CONTRACT_HASH: `hash-${"1".repeat(64)}`,
        MEMORY_ANCHOR_PACKAGE_HASH: `hash-${"2".repeat(64)}`
      }))
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
    expect(written.anchor_reason).toBe("casper_contract_not_configured");
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
    expect(written.anchor_reason).toBe("casper_client_not_configured");
    expect(written.anchor_id).toMatch(hex64);
    expect(written.casper_transaction_hash).toBeNull();
    expect(written.onchain_content_hash).toBeNull();
    expect(rawStore).toContain(written.anchor_id ?? "");
  });

  it("records explicit audit events for pending and submitted anchor attempts", async () => {
    const pendingDataDir = await mkdtemp(join(tmpdir(), "sigil-anchor-audit-pending-"));
    const pendingAudit = new AuditService(new FileAuditStore(pendingDataDir));
    const pendingMemory = new MemoryService(
      new FileMemoryStore(pendingDataDir),
      pendingAudit,
      new MockCasperAnchorClient()
    );

    const pending = await pendingMemory.write({
      agent_id: "agent-demo-1",
      type: "observation",
      body: { note: "audit pending anchor" },
      anchor: true
    });
    const pendingEvents = (await pendingAudit.tail({ agent_id: "agent-demo-1", limit: 10 })).events;

    expect(pending.anchor_status).toBe("pending");
    expect(pending.anchor_reason).toBe("casper_contract_not_configured");
    expect(pendingEvents.map((event) => event.event_type)).toContain("memory.anchor_pending");
    expect(pendingEvents.find((event) => event.event_type === "memory.anchor_pending")?.metadata)
      .toMatchObject({
        anchor_status: "pending",
        anchor_reason: "casper_contract_not_configured",
        casper_transaction_hash: null
      });

    const submittedDataDir = await mkdtemp(join(tmpdir(), "sigil-anchor-audit-submitted-"));
    const submittedAudit = new AuditService(new FileAuditStore(submittedDataDir));
    const transactionHash = "f".repeat(64);
    const submittedClient = new ConfiguredCasperAnchorClient(
      {
        networkName: "casper-test",
        caip2ChainId: "casper:casper-test",
        rpcUrl: "https://node.test/rpc",
        accountKeyPath: "./keys/backend.pem",
        memoryAnchorContractHash: `hash-${"1".repeat(64)}`,
        memoryAnchorPackageHash: `hash-${"2".repeat(64)}`,
        submissionEnabled: true,
        clientBin: "casper-client",
        clientWslDistro: null,
        anchorSubmissionMode: "transaction-package",
        gasPriceTolerance: "10",
        pricingMode: "classic",
        anchorPaymentAmountMotes: "3000000000",
        confirmationPollIntervalMs: 1,
        confirmationTimeoutMs: 1
      },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ transaction_hash: transactionHash }),
        stderr: ""
      })
    );
    const submittedMemory = new MemoryService(
      new FileMemoryStore(submittedDataDir),
      submittedAudit,
      submittedClient
    );

    const submitted = await submittedMemory.write({
      agent_id: "agent-demo-1",
      type: "observation",
      body: { note: "audit submitted anchor" },
      anchor: true
    });
    const submittedEvents = (await submittedAudit.tail({ agent_id: "agent-demo-1", limit: 10 })).events;

    expect(submitted.anchor_status).toBe("pending");
    expect(submitted.anchor_reason).toBe("casper_transaction_execution_unavailable");
    expect(submitted.casper_transaction_hash).toBe(transactionHash);
    expect(submittedEvents.map((event) => event.event_type)).toContain("memory.anchor_submitted");
    expect(submittedEvents.find((event) => event.event_type === "memory.anchor_submitted")?.metadata)
      .toMatchObject({
        anchor_status: "pending",
        anchor_reason: "casper_transaction_execution_unavailable",
        casper_transaction_hash: transactionHash
      });
  });

  it("marks anchored memory when Casper get-transaction reports successful execution", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-anchor-confirmed-"));
    const audit = new AuditService(new FileAuditStore(dataDir));
    const transactionHash = "e".repeat(64);
    const calls: { command: string; args: readonly string[] }[] = [];
    const anchorClient = new ConfiguredCasperAnchorClient(
      {
        networkName: "casper-test",
        caip2ChainId: "casper:casper-test",
        rpcUrl: "https://node.test/rpc",
        accountKeyPath: "./keys/backend.pem",
        memoryAnchorContractHash: `hash-${"1".repeat(64)}`,
        memoryAnchorPackageHash: `hash-${"2".repeat(64)}`,
        submissionEnabled: true,
        clientBin: "casper-client",
        clientWslDistro: null,
        anchorSubmissionMode: "transaction-package",
        gasPriceTolerance: "10",
        pricingMode: "classic",
        anchorPaymentAmountMotes: "3000000000",
        confirmationPollIntervalMs: 1,
        confirmationTimeoutMs: 1
      },
      async (command, args) => {
        calls.push({ command, args });
        if (args[0] === "get-transaction") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ result: { execution_info: [{ error_message: null }] } }),
            stderr: ""
          };
        }

        return {
          exitCode: 0,
          stdout: JSON.stringify({ result: { transaction_hash: transactionHash } }),
          stderr: ""
        };
      }
    );
    const memory = new MemoryService(new FileMemoryStore(dataDir), audit, anchorClient);

    const written = await memory.write({
      agent_id: "agent-demo-1",
      type: "observation",
      body: { note: "confirm anchor" },
      anchor: true
    });
    const events = (await audit.tail({ agent_id: "agent-demo-1", limit: 10 })).events;

    expect(written.anchor_status).toBe("anchored");
    expect(written.anchor_reason).toBeNull();
    expect(written.casper_transaction_hash).toBe(transactionHash);
    expect(written.onchain_content_hash).toBe(written.content_hash);
    expect(calls.map((call) => call.args[0])).toEqual(["put-transaction", "get-transaction"]);
    expect(events.map((event) => event.event_type)).toContain("memory.anchor_confirmed");
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
