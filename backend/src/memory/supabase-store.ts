import { SupabaseRestClient } from "../storage/supabase-rest.js";
import type { MemoryStore, StoredMemoryEntry } from "./types.js";

export class SupabaseMemoryStore implements MemoryStore {
  private readonly table: string;

  constructor(private readonly client: SupabaseRestClient) {
    this.table = client.table("memories");
  }

  async save(entry: StoredMemoryEntry): Promise<void> {
    await this.client.upsert(
      this.table,
      {
        agent_id: entry.agent_id,
        memory_id: entry.memory_id,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        record: entry
      },
      "agent_id,memory_id"
    );
  }

  async get(agentId: string, memoryId: string): Promise<StoredMemoryEntry | null> {
    const [record] = await this.client.selectRecords<StoredMemoryEntry>(this.table, {
      filters: { agent_id: agentId, memory_id: memoryId },
      limit: 1
    });

    return record ?? null;
  }

  async list(agentId: string): Promise<StoredMemoryEntry[]> {
    return this.client.selectRecords<StoredMemoryEntry>(this.table, {
      filters: { agent_id: agentId },
      order: { column: "created_at" }
    });
  }
}
