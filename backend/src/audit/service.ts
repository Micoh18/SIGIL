import { randomUUID } from "node:crypto";
import { toJsonObject } from "../memory/canonical.js";
import type { JsonObject, JsonValue } from "../memory/types.js";
import type { AuditEvent, AuditEventInput, AuditStore, AuditTailInput, AuditTailResult } from "./types.js";

const DEFAULT_TAIL_LIMIT = 50;
const MAX_TAIL_LIMIT = 200;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_METADATA_DEPTH = 6;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_ARRAY_ITEMS = 50;
const MAX_METADATA_STRING_LENGTH = 2048;
const TRUNCATED = "[truncated]";
const REDACTED = "[redacted]";

export class AuditService {
  constructor(private readonly store: AuditStore) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: createAuditId(),
      agent_id: input.agent_id ?? null,
      event_type: input.event_type,
      subject_type: input.subject_type,
      subject_id: input.subject_id ?? null,
      severity: input.severity ?? "info",
      metadata: sanitizeMetadata(input.metadata ?? {}),
      created_at: new Date().toISOString()
    };

    await this.store.append(event);
    return event;
  }

  async tail(input: AuditTailInput = {}): Promise<AuditTailResult> {
    const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_TAIL_LIMIT, MAX_TAIL_LIMIT));
    const events = (await this.store.list())
      .filter((event) => !input.agent_id || event.agent_id === input.agent_id)
      .filter((event) => !input.event_type || event.event_type === input.event_type)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit);

    return {
      count: events.length,
      events
    };
  }
}

function sanitizeMetadata(metadata: unknown) {
  const object = toJsonObject(metadata, "metadata");
  const bounded = redactAndBound(object, 0);
  const size = Buffer.byteLength(JSON.stringify(bounded), "utf8");

  if (size > MAX_METADATA_BYTES) {
    return {
      truncated: true,
      original_size_bytes: size
    };
  }

  return bounded;
}

function redactAndBound<T extends JsonValue>(value: T, depth: number): T {
  if (depth >= MAX_METADATA_DEPTH) {
    return TRUNCATED as T;
  }

  if (Array.isArray(value)) {
    const boundedItems = value
      .slice(0, MAX_METADATA_ARRAY_ITEMS)
      .map((item) => redactAndBound(item, depth + 1));

    if (value.length > MAX_METADATA_ARRAY_ITEMS) {
      boundedItems.push(TRUNCATED);
    }

    return boundedItems as T;
  }

  if (value && typeof value === "object") {
    const redacted: JsonObject = {};
    const entries = Object.entries(value).slice(0, MAX_METADATA_KEYS);

    for (const [key, nestedValue] of entries) {
      if (isSensitiveKey(key)) {
        redacted[key] = REDACTED;
      } else {
        redacted[key] = redactAndBound(nestedValue, depth + 1);
      }
    }

    if (Object.keys(value).length > MAX_METADATA_KEYS) {
      redacted.truncated_keys = true;
    }

    return redacted as T;
  }

  if (typeof value === "string" && value.length > MAX_METADATA_STRING_LENGTH) {
    return `${value.slice(0, MAX_METADATA_STRING_LENGTH)}${TRUNCATED}` as T;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  if (/(_hash|Hash|hash)$/.test(key)) {
    return false;
  }

  return /secret|token|key|password|private|payload|credential|authorization|signature|value/i.test(key);
}

function createAuditId(): string {
  return `aud_${randomUUID().replaceAll("-", "")}`;
}
