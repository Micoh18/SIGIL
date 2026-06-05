import { randomUUID } from "node:crypto";
import type { AuditService } from "../audit/service.js";
import type { CasperAnchorClient } from "../casper/anchorClient.js";
import { canonicalizeJson, toJsonObject } from "./canonical.js";
import { sha256Hex } from "./hash.js";
import type {
  MemoryEnvelope,
  MemorySearchResult,
  MemoryStore,
  MemorySummary,
  StoredMemoryEntry,
  WriteMemoryInput
} from "./types.js";

const MEMORY_SCHEMA_VERSION = "sigil.memory.v1";

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly audit?: AuditService,
    private readonly anchorClient?: CasperAnchorClient
  ) {}

  async write(input: WriteMemoryInput): Promise<StoredMemoryEntry> {
    const memoryId = input.memory_id ?? createMemoryId();
    const createdAt = new Date().toISOString();
    const source = toJsonObject(input.source ?? {}, "source");
    const body = toJsonObject(input.body, "body");

    const envelope: MemoryEnvelope = {
      schema_version: MEMORY_SCHEMA_VERSION,
      agent_id: input.agent_id,
      memory_id: memoryId,
      type: input.type,
      source,
      body,
      created_at: createdAt,
      prev_anchor_hash: input.prev_anchor_hash ?? null
    };

    const canonicalJson = canonicalizeJson(envelope);
    const contentHash = sha256Hex(canonicalJson);
    const metadataHash = sha256Hex(
      canonicalizeJson({
        agent_id: envelope.agent_id,
        memory_id: envelope.memory_id,
        type: envelope.type,
        source: envelope.source,
        created_at: envelope.created_at
      })
    );

    let anchorResult = null;
    if (input.anchor) {
      anchorResult = await this.anchorClient?.anchorMemory({
        agent_id: envelope.agent_id,
        memory_id: envelope.memory_id,
        content_hash: contentHash,
        metadata_hash: metadataHash,
        prev_anchor_hash: envelope.prev_anchor_hash
      });
    }

    const entry: StoredMemoryEntry = {
      ...envelope,
      canonical_json: canonicalJson,
      content_hash: contentHash,
      metadata_hash: metadataHash,
      anchor_status: anchorResult?.status ?? (input.anchor ? "pending" : "not_requested"),
      anchor_id: anchorResult?.anchor_id ?? null,
      casper_transaction_hash: anchorResult?.casper_transaction_hash ?? null,
      onchain_content_hash: anchorResult?.onchain_content_hash ?? null,
      updated_at: createdAt
    };

    await this.store.save(entry);
    await this.audit?.record({
      agent_id: entry.agent_id,
      event_type: "memory.created",
      subject_type: "memory",
      subject_id: entry.memory_id,
      metadata: {
        type: entry.type,
        content_hash: entry.content_hash,
        metadata_hash: entry.metadata_hash,
        anchor_status: entry.anchor_status
      }
    });
    return entry;
  }

  async read(agentId: string, memoryId: string): Promise<StoredMemoryEntry | null> {
    return this.store.get(agentId, memoryId);
  }

  async search(agentId: string, query: string, limit = 10): Promise<MemorySearchResult> {
    const normalizedQuery = query.trim().toLowerCase();
    const entries = await this.store.list(agentId);

    const results = entries
      .filter((entry) => {
        if (normalizedQuery.length === 0) {
          return true;
        }

        return buildSearchText(entry).includes(normalizedQuery);
      })
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map(toSummary);

    return {
      agent_id: agentId,
      query,
      count: results.length,
      results
    };
  }

  async verify(agentId: string, memoryId: string) {
    const entry = await this.store.get(agentId, memoryId);

    if (!entry) {
      return {
        valid: false,
        reason: "memory_not_found",
        agent_id: agentId,
        memory_id: memoryId
      };
    }

    const envelope = toEnvelope(entry);
    const localContentHash = sha256Hex(canonicalizeJson(envelope));
    const localValid = localContentHash === entry.content_hash;

    await this.audit?.record({
      agent_id: agentId,
      event_type: localValid ? "memory.verify_succeeded" : "memory.verify_failed",
      subject_type: "memory",
      subject_id: memoryId,
      severity: localValid ? "info" : "warn",
      metadata: {
        local_content_hash: localContentHash,
        stored_content_hash: entry.content_hash,
        anchor_status: entry.anchor_status
      }
    });

    return {
      valid: localValid,
      local_valid: localValid,
      anchor_status: entry.anchor_status,
      agent_id: agentId,
      memory_id: memoryId,
      local_content_hash: localContentHash,
      stored_content_hash: entry.content_hash,
      onchain_content_hash: entry.onchain_content_hash ?? null,
      anchor_id: entry.anchor_id ?? null,
      casper_transaction_hash: entry.casper_transaction_hash ?? null
    };
  }
}

function createMemoryId(): string {
  return `mem_${randomUUID().replaceAll("-", "")}`;
}

function buildSearchText(entry: StoredMemoryEntry): string {
  return [
    entry.memory_id,
    entry.type,
    JSON.stringify(entry.source),
    JSON.stringify(entry.body),
    entry.content_hash
  ]
    .join(" ")
    .toLowerCase();
}

function toSummary(entry: StoredMemoryEntry): MemorySummary {
  return {
    memory_id: entry.memory_id,
    type: entry.type,
    content_hash: entry.content_hash,
    anchor_status: entry.anchor_status,
    created_at: entry.created_at,
    source: entry.source
  };
}

function toEnvelope(entry: StoredMemoryEntry): MemoryEnvelope {
  return {
    schema_version: entry.schema_version,
    agent_id: entry.agent_id,
    memory_id: entry.memory_id,
    type: entry.type,
    source: entry.source,
    body: entry.body,
    created_at: entry.created_at,
    prev_anchor_hash: entry.prev_anchor_hash
  };
}

