import type { JsonObject } from "../memory/types.js";

export type AuditSeverity = "debug" | "info" | "warn" | "error";

export type AuditEventInput = {
  agent_id?: string | null;
  event_type: string;
  subject_type: string;
  subject_id?: string | null;
  severity?: AuditSeverity;
  metadata?: JsonObject;
};

export type AuditEvent = Required<Omit<AuditEventInput, "severity" | "metadata" | "agent_id" | "subject_id">> & {
  id: string;
  agent_id: string | null;
  subject_id: string | null;
  severity: AuditSeverity;
  metadata: JsonObject;
  created_at: string;
};

export type AuditTailInput = {
  agent_id?: string;
  event_type?: string;
  limit?: number;
};

export type AuditTailResult = {
  count: number;
  events: AuditEvent[];
};

export type AuditStore = {
  append(event: AuditEvent): Promise<void>;
  list(): Promise<AuditEvent[]>;
};
