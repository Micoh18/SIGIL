import { join } from "node:path";
import { JsonFileStore } from "../storage/json-file-store.js";
import type { MemoryStore, StoredMemoryEntry } from "./types.js";

type MemoryStoreFile = {
  schema_version: "sigil.memory-store.v1";
  memories: StoredMemoryEntry[];
};

export class FileMemoryStore implements MemoryStore {
  private readonly store: JsonFileStore<MemoryStoreFile>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore({
      filePath: join(dataDir, "memory.json"),
      empty: emptyStore,
      normalize: normalizeStore
    });
  }

  async save(entry: StoredMemoryEntry): Promise<void> {
    await this.store.update((data) => {
      const existingIndex = data.memories.findIndex(
        (memory) => memory.agent_id === entry.agent_id && memory.memory_id === entry.memory_id
      );

      if (existingIndex >= 0) {
        data.memories[existingIndex] = entry;
      } else {
        data.memories.push(entry);
      }
    });
  }

  async get(agentId: string, memoryId: string): Promise<StoredMemoryEntry | null> {
    const data = await this.store.read();

    return (
      data.memories.find(
        (memory) => memory.agent_id === agentId && memory.memory_id === memoryId
      ) ?? null
    );
  }

  async list(agentId: string): Promise<StoredMemoryEntry[]> {
    const data = await this.store.read();

    return data.memories
      .filter((memory) => memory.agent_id === agentId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }
}

function emptyStore(): MemoryStoreFile {
  return {
    schema_version: "sigil.memory-store.v1",
    memories: []
  };
}

function normalizeStore(parsed: unknown): MemoryStoreFile {
  const data = asStoreObject(parsed);

  return {
    schema_version: "sigil.memory-store.v1",
    memories: Array.isArray(data.memories)
      ? (data.memories as StoredMemoryEntry[]).map(normalizeMemoryEntry)
      : []
  };
}

function normalizeMemoryEntry(entry: StoredMemoryEntry): StoredMemoryEntry {
  return {
    ...entry,
    anchor_reason: entry.anchor_reason ?? null
  };
}

function asStoreObject(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
