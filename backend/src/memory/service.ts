import { randomUUID } from "node:crypto";
import type { AuditService } from "../audit/service.js";
import {
  createAnchorSubmission,
  createPendingAnchorResult,
  type AnchorSubmission,
  type AnchorSubmissionResult,
  type CasperAnchorClient
} from "../casper/anchorClient.js";
import { canonicalizeJson, toJsonObject } from "./canonical.js";
import { sha256Hex } from "./hash.js";
import type {
  JsonObject,
  MemoryEnvelope,
  MemorySearchResult,
  MemoryStore,
  MemorySummary,
  StoredMemoryEntry,
  WriteMemoryInput
} from "./types.js";

const MEMORY_SCHEMA_VERSION = "sigil.memory.v1";
const SEARCH_STOPWORDS = new Set([
  "a",
  "about",
  "again",
  "an",
  "and",
  "anything",
  "are",
  "as",
  "before",
  "did",
  "do",
  "for",
  "from",
  "have",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "or",
  "project",
  "remember",
  "said",
  "should",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "with",
  "you"
]);

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly audit?: AuditService,
    private readonly anchorClient?: CasperAnchorClient
  ) {}

  async write(input: WriteMemoryInput): Promise<StoredMemoryEntry> {
    const memoryId = input.memory_id ?? createMemoryId();
    const createdAt = new Date().toISOString();
    const source = toMemoryObject(input.source ?? {}, "source");
    const body = toMemoryObject(input.body, "body");

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

    let anchorSubmission: AnchorSubmission | null = null;
    let anchorResult: AnchorSubmissionResult | null = null;
    if (input.anchor) {
      anchorSubmission = createAnchorSubmission({
        agent_id: envelope.agent_id,
        memory_id: envelope.memory_id,
        content_hash: contentHash,
        metadata_hash: metadataHash,
        prev_anchor_hash: envelope.prev_anchor_hash
      });
      anchorResult = this.anchorClient
        ? await this.anchorClient.anchorMemory(anchorSubmission)
        : createPendingAnchorResult(anchorSubmission, "casper_client_not_configured");
    }

    const entry: StoredMemoryEntry = {
      ...envelope,
      canonical_json: canonicalJson,
      content_hash: contentHash,
      metadata_hash: metadataHash,
      anchor_status: anchorResult?.status ?? (input.anchor ? "pending" : "not_requested"),
      anchor_id: anchorResult?.anchor_id ?? anchorSubmission?.anchor_id ?? null,
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
    const queryTokens = tokenizeSearchText(query);
    const entries = await this.store.list(agentId);

    const results = entries
      .filter((entry) => {
        if (queryTokens.length === 0) {
          return true;
        }

        return matchesSearch(entry, queryTokens);
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

function toMemoryObject(value: unknown, path: string): JsonObject {
  if (typeof value === "string") {
    return { note: value };
  }

  return toJsonObject(value, path);
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

function matchesSearch(entry: StoredMemoryEntry, queryTokens: string[]): boolean {
  const entryTokens = new Set(tokenizeSearchText(buildSearchText(entry)));

  return queryTokens.every((queryToken) => entryTokens.has(queryToken));
}

function tokenizeSearchText(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token))
        .map(normalizeSearchToken)
        .filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token))
    )
  ];
}

function normalizeSearchToken(token: string): string {
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }

  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
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

