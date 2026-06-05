import { join } from "node:path";
import { JsonFileStore } from "../storage/json-file-store.js";
import type { AuditEvent, AuditStore } from "./types.js";

type AuditStoreFile = {
  schema_version: "sigil.audit-store.v1";
  events: AuditEvent[];
};

export class FileAuditStore implements AuditStore {
  private readonly store: JsonFileStore<AuditStoreFile>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore({
      filePath: join(dataDir, "audit.json"),
      empty: emptyStore,
      normalize: normalizeStore
    });
  }

  async append(event: AuditEvent): Promise<void> {
    await this.store.update((data) => {
      data.events.push(event);
    });
  }

  async list(): Promise<AuditEvent[]> {
    const data = await this.store.read();
    return [...data.events];
  }
}

function emptyStore(): AuditStoreFile {
  return {
    schema_version: "sigil.audit-store.v1",
    events: []
  };
}

function normalizeStore(parsed: unknown): AuditStoreFile {
  const data = asStoreObject(parsed);

  return {
    schema_version: "sigil.audit-store.v1",
    events: Array.isArray(data.events) ? (data.events as AuditEvent[]) : []
  };
}

function asStoreObject(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
