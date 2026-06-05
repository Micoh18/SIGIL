export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const memoryTypes = [
  "observation",
  "decision",
  "payment",
  "secret_usage",
  "system_event"
] as const;

export type MemoryType = (typeof memoryTypes)[number];

export type AnchorStatus = "not_requested" | "pending" | "anchored" | "failed";

export type MemoryEnvelope = {
  schema_version: "sigil.memory.v1";
  agent_id: string;
  memory_id: string;
  type: MemoryType;
  source: JsonObject;
  body: JsonObject;
  created_at: string;
  prev_anchor_hash: string | null;
};

export type StoredMemoryEntry = MemoryEnvelope & {
  canonical_json: string;
  content_hash: string;
  metadata_hash: string;
  anchor_status: AnchorStatus;
  anchor_id: string | null;
  casper_transaction_hash: string | null;
  onchain_content_hash: string | null;
  updated_at: string;
};

export type WriteMemoryInput = {
  agent_id: string;
  type: MemoryType;
  body: unknown;
  source?: unknown;
  anchor?: boolean;
  memory_id?: string;
  prev_anchor_hash?: string | null;
};

export type MemorySummary = {
  memory_id: string;
  type: MemoryType;
  content_hash: string;
  anchor_status: AnchorStatus;
  created_at: string;
  source: JsonObject;
};

export type MemorySearchResult = {
  agent_id: string;
  query: string;
  count: number;
  results: MemorySummary[];
};

export type MemoryStore = {
  save(entry: StoredMemoryEntry): Promise<void>;
  get(agentId: string, memoryId: string): Promise<StoredMemoryEntry | null>;
  list(agentId: string): Promise<StoredMemoryEntry[]>;
};

