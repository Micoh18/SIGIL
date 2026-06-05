import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuditEvent, AuditStore } from "./types.js";

type AuditStoreFile = {
  schema_version: "sigil.audit-store.v1";
  events: AuditEvent[];
};

export class FileAuditStore implements AuditStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "audit.json");
  }

  async append(event: AuditEvent): Promise<void> {
    const data = await this.load();
    data.events.push(event);
    await this.persist(data);
  }

  async list(): Promise<AuditEvent[]> {
    const data = await this.load();
    return [...data.events];
  }

  private async load(): Promise<AuditStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as AuditStoreFile;

      return {
        schema_version: "sigil.audit-store.v1",
        events: Array.isArray(parsed.events) ? parsed.events : []
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return emptyStore();
      }

      throw error;
    }
  }

  private async persist(data: AuditStoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

function emptyStore(): AuditStoreFile {
  return {
    schema_version: "sigil.audit-store.v1",
    events: []
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
