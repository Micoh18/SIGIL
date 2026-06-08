import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAuditStore } from "../src/audit/store.js";
import type { AuditEvent } from "../src/audit/types.js";
import { FileGrimoireStore } from "../src/grimoire/store.js";
import type { PolicyRecord, SecretRecord } from "../src/grimoire/types.js";
import { FileMemoryStore } from "../src/memory/store.js";
import type { StoredMemoryEntry } from "../src/memory/types.js";
import { FilePaymentStore } from "../src/payments/store.js";
import type { PaymentIntentRecord, PaymentReceiptRecord } from "../src/payments/types.js";

describe("file-backed stores", () => {
  it("keeps records across new store instances and preserves schema versions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-file-stores-restart-"));

    await new FileMemoryStore(dataDir).save(memoryEntry(1));
    await new FileAuditStore(dataDir).append(auditEvent(1));
    await new FileGrimoireStore(dataDir).saveSecret(secretRecord(1));
    await new FileGrimoireStore(dataDir).savePolicy(policyRecord(1));
    await new FilePaymentStore(dataDir).saveIntent(paymentIntent(1));
    await new FilePaymentStore(dataDir).saveReceipt(paymentReceipt(1));

    expect(await new FileMemoryStore(dataDir).get("agent-demo-1", "mem_1")).toMatchObject({
      memory_id: "mem_1"
    });
    expect(await new FileAuditStore(dataDir).list()).toHaveLength(1);
    expect(await new FileGrimoireStore(dataDir).getSecretByName("agent-demo-1", "secret-1"))
      .toMatchObject({ id: "sec_1" });
    expect(await new FileGrimoireStore(dataDir).getPolicy("agent-demo-1", "pol_1")).toMatchObject({
      policy_id: "pol_1"
    });
    expect(await new FilePaymentStore(dataDir).getIntent("pay_1")).toMatchObject({
      id: "pay_1"
    });
    expect(await new FilePaymentStore(dataDir).getReceipt("pay_1")).toMatchObject({
      id: "receipt_1"
    });

    await expectStoreSchema(dataDir, "memory.json", "sigil.memory-store.v1");
    await expectStoreSchema(dataDir, "audit.json", "sigil.audit-store.v1");
    await expectStoreSchema(dataDir, "grimoire.json", "sigil.grimoire-store.v1");
    await expectStoreSchema(dataDir, "payments.json", "sigil.payment-store.v1");
  });

  it("serializes concurrent writes without losing records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-file-stores-concurrent-"));
    const indexes = Array.from({ length: 30 }, (_, index) => index + 1);

    await Promise.all(indexes.map((index) => new FileMemoryStore(dataDir).save(memoryEntry(index))));
    await Promise.all(indexes.map((index) => new FileAuditStore(dataDir).append(auditEvent(index))));
    await Promise.all([
      ...indexes.map((index) => new FileGrimoireStore(dataDir).saveSecret(secretRecord(index))),
      ...indexes.map((index) => new FileGrimoireStore(dataDir).savePolicy(policyRecord(index)))
    ]);
    await Promise.all([
      ...indexes.map((index) => new FilePaymentStore(dataDir).saveIntent(paymentIntent(index))),
      ...indexes.map((index) => new FilePaymentStore(dataDir).saveReceipt(paymentReceipt(index)))
    ]);

    expect(await new FileMemoryStore(dataDir).list("agent-demo-1")).toHaveLength(indexes.length);
    expect(await new FileAuditStore(dataDir).list()).toHaveLength(indexes.length);
    expect(await new FileGrimoireStore(dataDir).listSecrets("agent-demo-1")).toHaveLength(
      indexes.length
    );

    await Promise.all(
      indexes.map(async (index) => {
        await expect(new FileGrimoireStore(dataDir).getPolicy("agent-demo-1", `pol_${index}`))
          .resolves.toMatchObject({ policy_id: `pol_${index}` });
        await expect(new FilePaymentStore(dataDir).getIntent(`pay_${index}`)).resolves.toMatchObject({
          id: `pay_${index}`
        });
        await expect(new FilePaymentStore(dataDir).getReceipt(`pay_${index}`))
          .resolves.toMatchObject({ id: `receipt_${index}` });
      })
    );
  });

  it("starts from empty data when store files are missing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-file-stores-missing-"));

    await expect(new FileMemoryStore(dataDir).list("agent-demo-1")).resolves.toEqual([]);
    await expect(new FileAuditStore(dataDir).list()).resolves.toEqual([]);
    await expect(new FileGrimoireStore(dataDir).listSecrets("agent-demo-1")).resolves.toEqual([]);
    await expect(new FileGrimoireStore(dataDir).getPolicy("agent-demo-1", "pol_1")).resolves.toBeNull();
    await expect(new FilePaymentStore(dataDir).getIntent("pay_1")).resolves.toBeNull();
    await expect(new FilePaymentStore(dataDir).getReceipt("pay_1")).resolves.toBeNull();
  });

  it("fails clearly when store files contain corrupt JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-file-stores-corrupt-"));
    const cases = [
      {
        fileName: "memory.json",
        read: () => new FileMemoryStore(dataDir).list("agent-demo-1")
      },
      {
        fileName: "audit.json",
        read: () => new FileAuditStore(dataDir).list()
      },
      {
        fileName: "grimoire.json",
        read: () => new FileGrimoireStore(dataDir).listSecrets("agent-demo-1")
      },
      {
        fileName: "payments.json",
        read: () => new FilePaymentStore(dataDir).getIntent("pay_1")
      }
    ];

    for (const testCase of cases) {
      const filePath = join(dataDir, testCase.fileName);
      await writeFile(filePath, "{ corrupt json", "utf8");

      await expect(testCase.read()).rejects.toThrow("Failed to parse JSON store file at");
      await expect(testCase.read()).rejects.toThrow(filePath);
    }
  });
});

async function expectStoreSchema(
  dataDir: string,
  fileName: string,
  expectedSchemaVersion: string
): Promise<void> {
  const raw = await readFile(join(dataDir, fileName), "utf8");
  const parsed = JSON.parse(raw) as { schema_version?: unknown };
  expect(parsed.schema_version).toBe(expectedSchemaVersion);
}

function memoryEntry(index: number): StoredMemoryEntry {
  const createdAt = timestamp(index);

  return {
    schema_version: "sigil.memory.v1",
    agent_id: "agent-demo-1",
    memory_id: `mem_${index}`,
    type: "observation",
    source: { kind: "test" },
    body: { index },
    created_at: createdAt,
    prev_anchor_hash: null,
    canonical_json: `{"index":${index}}`,
    content_hash: `content_hash_${index}`,
    metadata_hash: `metadata_hash_${index}`,
    anchor_status: "not_requested",
    anchor_reason: null,
    anchor_id: null,
    casper_transaction_hash: null,
    onchain_content_hash: null,
    updated_at: createdAt
  };
}

function auditEvent(index: number): AuditEvent {
  return {
    id: `aud_${index}`,
    agent_id: "agent-demo-1",
    event_type: "test.event",
    subject_type: "test",
    subject_id: `subject_${index}`,
    severity: "info",
    metadata: { index },
    created_at: timestamp(index)
  };
}

function secretRecord(index: number): SecretRecord {
  const createdAt = timestamp(index);

  return {
    id: `sec_${index}`,
    agent_id: "agent-demo-1",
    name: `secret-${index}`,
    type: "api_key",
    scopes: ["api:read"],
    ciphertext: `ciphertext_${index}`,
    nonce: `nonce_${index}`,
    auth_tag: `auth_tag_${index}`,
    key_version: "v1",
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null
  };
}

function policyRecord(index: number): PolicyRecord {
  const createdAt = timestamp(index);

  return {
    agent_id: "agent-demo-1",
    policy_id: `pol_${index}`,
    enabled: true,
    allowed_urls: ["http://localhost:4021/weather"],
    allowed_methods: ["GET"],
    allowed_asset: { caip2_chain_id: "casper:casper-test" },
    max_amount_per_call: "0.05",
    max_amount_per_period: "1.00",
    period_seconds: 86400,
    secret_scopes: ["x402:sign"],
    policy_hash: `policy_hash_${index}`,
    current_period_spend: "0",
    period_started_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt
  };
}

function paymentIntent(index: number): PaymentIntentRecord {
  const createdAt = timestamp(index);

  return {
    id: `pay_${index}`,
    agent_id: "agent-demo-1",
    policy_id: `pol_${index}`,
    method: "GET",
    url: "http://localhost:4021/weather",
    amount: "0.01",
    status: "policy_checked",
    idempotency_key: `idem_${index}`,
    policy_hash: `policy_hash_${index}`,
    denial_reason: null,
    requirements_json: null,
    signed_payload_hash: null,
    created_at: createdAt,
    updated_at: createdAt
  };
}

function paymentReceipt(index: number): PaymentReceiptRecord {
  return {
    id: `receipt_${index}`,
    payment_id: `pay_${index}`,
    facilitator_url: "http://localhost:4021",
    casper_transaction_hash: null,
    settlement_status: "pending",
    response_hash: null,
    response_status: null,
    receipt_json: "{}",
    created_at: timestamp(index)
  };
}

function timestamp(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
}
