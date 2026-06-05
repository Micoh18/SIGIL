import { SupabaseRestClient } from "../storage/supabase-rest.js";
import type { AuditEvent, AuditStore } from "./types.js";

export class SupabaseAuditStore implements AuditStore {
  private readonly table: string;

  constructor(private readonly client: SupabaseRestClient) {
    this.table = client.table("audit_events");
  }

  async append(event: AuditEvent): Promise<void> {
    await this.client.insert(this.table, {
      id: event.id,
      agent_id: event.agent_id,
      event_type: event.event_type,
      created_at: event.created_at,
      record: event
    });
  }

  async list(): Promise<AuditEvent[]> {
    return this.client.selectRecords<AuditEvent>(this.table, {
      order: { column: "created_at", ascending: true }
    });
  }
}
