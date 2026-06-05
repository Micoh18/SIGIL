import { randomUUID } from "node:crypto";
import { toJsonObject } from "../memory/canonical.js";
import type { AuditEvent, AuditEventInput, AuditStore, AuditTailInput, AuditTailResult } from "./types.js";

const DEFAULT_TAIL_LIMIT = 50;
const MAX_TAIL_LIMIT = 200;

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
  return redactSecrets(object);
}

function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (/secret|token|key|password|private|payload/i.test(key)) {
        redacted[key] = "[redacted]";
      } else {
        redacted[key] = redactSecrets(nestedValue);
      }
    }
    return redacted as T;
  }

  return value;
}

function createAuditId(): string {
  return `aud_${randomUUID().replaceAll("-", "")}`;
}
