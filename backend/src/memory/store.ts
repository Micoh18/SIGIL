import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryStore, StoredMemoryEntry } from "./types.js";

type MemoryStoreFile = {
  schema_version: "sigil.memory-store.v1";
  memories: StoredMemoryEntry[];
};

export class FileMemoryStore implements MemoryStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "memory.json");
  }

  async save(entry: StoredMemoryEntry): Promise<void> {
    const data = await this.load();
    const existingIndex = data.memories.findIndex(
      (memory) => memory.agent_id === entry.agent_id && memory.memory_id === entry.memory_id
    );

    if (existingIndex >= 0) {
      data.memories[existingIndex] = entry;
    } else {
      data.memories.push(entry);
    }

    await this.persist(data);
  }

  async get(agentId: string, memoryId: string): Promise<StoredMemoryEntry | null> {
    const data = await this.load();

    return (
      data.memories.find(
        (memory) => memory.agent_id === agentId && memory.memory_id === memoryId
      ) ?? null
    );
  }

  async list(agentId: string): Promise<StoredMemoryEntry[]> {
    const data = await this.load();

    return data.memories
      .filter((memory) => memory.agent_id === agentId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  private async load(): Promise<MemoryStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as MemoryStoreFile;

      return {
        schema_version: "sigil.memory-store.v1",
        memories: Array.isArray(parsed.memories) ? parsed.memories : []
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return emptyStore();
      }

      throw error;
    }
  }

  private async persist(data: MemoryStoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

function emptyStore(): MemoryStoreFile {
  return {
    schema_version: "sigil.memory-store.v1",
    memories: []
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
