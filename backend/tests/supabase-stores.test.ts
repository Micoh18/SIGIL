import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createBackendStores } from "../src/storage/store-factory.js";
import { SupabaseRestClient } from "../src/storage/supabase-rest.js";
import type { SigilConfig } from "../src/config.js";
import type { AuditEvent } from "../src/audit/types.js";
import type { SecretRecord, PolicyRecord } from "../src/grimoire/types.js";
import type { StoredMemoryEntry } from "../src/memory/types.js";
import type { PaymentIntentRecord, PaymentReceiptRecord } from "../src/payments/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Supabase storage", () => {
  it("loads Supabase config from the project env names", () => {
    const loaded = loadConfig({
      SIGIL_STORAGE_BACKEND: "supabase",
      PROJECT_URL: "https://example.supabase.co",
      SECRET_KEY: "secret-key",
      SUPABASE_DB_SCHEMA: "public",
      SUPABASE_TABLE_PREFIX: "mainspring_"
    });

    expect(loaded.storage).toEqual({
      backend: "supabase",
      supabase: {
        url: "https://example.supabase.co",
        key: "secret-key",
        schema: "public",
        tablePrefix: "mainspring_"
      }
    });
  });

  it("uses Supabase stores when Supabase storage is configured", () => {
    const stores = createBackendStores(config());

    expect(stores.memory.constructor.name).toBe("SupabaseMemoryStore");
    expect(stores.grimoire.constructor.name).toBe("SupabaseGrimoireStore");
    expect(stores.payments.constructor.name).toBe("SupabasePaymentStore");
    expect(stores.audit.constructor.name).toBe("SupabaseAuditStore");
  });

  it("upserts and reads records through Supabase REST with the configured prefix", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} });
        const url = String(input);

        if (url.includes("/sigil_memories?")) {
          return jsonResponse([{ record: memoryEntry(1) }]);
        }

        return new Response(null, { status: 204 });
      })
    );
    const client = new SupabaseRestClient({
      url: "https://example.supabase.co",
      key: "service-role-key",
      schema: "public",
      tablePrefix: "sigil_"
    });
    const stores = createBackendStores({
      ...config(),
      storage: {
        backend: "supabase",
        supabase: {
          url: "https://example.supabase.co",
          key: "service-role-key",
          schema: "public",
          tablePrefix: "sigil_"
        }
      }
    });

    await stores.memory.save(memoryEntry(1));
    await expect(stores.memory.get("agent-demo-1", "mem_1")).resolves.toMatchObject({
      memory_id: "mem_1"
    });
    expect(client.table("memories")).toBe("sigil_memories");

    const [upsertRequest, selectRequest] = requests;
    expect(upsertRequest.url).toBe("https://example.supabase.co/rest/v1/sigil_memories?on_conflict=agent_id%2Cmemory_id");
    expect(upsertRequest.init.method).toBe("POST");
    expect(upsertRequest.init.headers).toMatchObject({
      apikey: "service-role-key",
      Authorization: "Bearer service-role-key",
      "Accept-Profile": "public",
      "Content-Profile": "public",
      Prefer: "resolution=merge-duplicates,return=minimal"
    });
    expect(JSON.parse(String(upsertRequest.init.body))).toMatchObject({
      agent_id: "agent-demo-1",
      memory_id: "mem_1",
      record: { memory_id: "mem_1" }
    });
    expect(selectRequest.url).toContain("/rest/v1/sigil_memories?");
    expect(selectRequest.url).toContain("agent_id=eq.agent-demo-1");
    expect(selectRequest.url).toContain("memory_id=eq.mem_1");
  });

  it("covers all Supabase-backed store operations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.includes("/sigil_memories?")) {
          return jsonResponse([{ record: memoryEntry(1) }]);
        }
        if (url.includes("/sigil_secrets?")) {
          return jsonResponse([{ record: secretRecord(1) }]);
        }
        if (url.includes("/sigil_policies?")) {
          return jsonResponse([{ record: policyRecord(1) }]);
        }
        if (url.includes("/sigil_payment_intents?")) {
          return jsonResponse([{ record: paymentIntent(1) }]);
        }
        if (url.includes("/sigil_payment_receipts?")) {
          return jsonResponse([{ record: paymentReceipt(1) }]);
        }
        if (url.includes("/sigil_audit_events?")) {
          return jsonResponse([{ record: auditEvent(1) }]);
        }

        return new Response(null, { status: 204 });
      })
    );
    const stores = createBackendStores(config());

    await stores.grimoire.saveSecret(secretRecord(1));
    await stores.grimoire.savePolicy(policyRecord(1));
    await stores.payments.saveIntent(paymentIntent(1));
    await stores.payments.saveReceipt(paymentReceipt(1));
    await stores.audit.append(auditEvent(1));

    await expect(stores.memory.list("agent-demo-1")).resolves.toHaveLength(1);
    await expect(stores.grimoire.getSecretByName("agent-demo-1", "secret-1"))
      .resolves.toMatchObject({ id: "sec_1" });
    await expect(stores.grimoire.getPolicy("agent-demo-1", "pol_1"))
      .resolves.toMatchObject({ policy_id: "pol_1" });
    await expect(stores.payments.getIntent("pay_1")).resolves.toMatchObject({ id: "pay_1" });
    await expect(stores.payments.findIntentByIdempotencyKey("agent-demo-1", "idem_1"))
      .resolves.toMatchObject({ id: "pay_1" });
    await expect(stores.payments.getReceipt("pay_1"))
      .resolves.toMatchObject({ id: "receipt_1" });
    await expect(stores.audit.list()).resolves.toHaveLength(1);
  });

  it("fails clearly on Supabase REST errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{\"message\":\"bad key\"}", { status: 401 }))
    );
    const stores = createBackendStores(config());

    await expect(stores.memory.list("agent-demo-1")).rejects.toThrow(
      "Supabase request failed: 401"
    );
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function config(): SigilConfig {
  return {
    dataDir: ".sigil",
    grimoireMasterKey: Buffer.alloc(32, 1),
    serverName: "mr-mainspring-test",
    serverVersion: "0.1.0-test",
    storage: {
      backend: "supabase",
      supabase: {
        url: "https://example.supabase.co",
        key: "service-role-key",
        schema: "public",
        tablePrefix: "sigil_"
      }
    },
    casper: {
      networkName: "casper-test",
      caip2ChainId: "casper:casper-test",
      rpcUrl: null,
      accountKeyPath: "./keys/backend.pem",
      memoryAnchorContractHash: null,
      memoryAnchorPackageHash: null
    },
    x402: {
      facilitatorUrl: "http://localhost:4022",
      resourceDemoUrl: "http://localhost:4021/weather",
      assetPackage: null,
      assetName: null
    }
  };
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
    content_hash: "a".repeat(64),
    metadata_hash: "b".repeat(64),
    anchor_status: "not_requested",
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
    settlement_blocker: null,
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
