import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

type JsonFileStoreOptions<T> = {
  filePath: string;
  empty: () => T;
  normalize: (parsed: unknown) => T;
};

const fileLocks = new Map<string, Promise<void>>();

export class JsonFileStore<T> {
  private readonly filePath: string;
  private readonly lockKey: string;
  private readonly empty: () => T;
  private readonly normalize: (parsed: unknown) => T;

  constructor(options: JsonFileStoreOptions<T>) {
    this.filePath = options.filePath;
    this.lockKey = resolve(options.filePath);
    this.empty = options.empty;
    this.normalize = options.normalize;
  }

  async read(): Promise<T> {
    return this.readUnlocked();
  }

  async update(mutator: (data: T) => void | Promise<void>): Promise<void> {
    await withFileLock(this.lockKey, async () => {
      const data = await this.readUnlocked();
      await mutator(data);
      await this.writeUnlocked(data);
    });
  }

  private async readUnlocked(): Promise<T> {
    let raw: string;

    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return this.empty();
      }

      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse JSON store file at ${this.filePath}: ${formatErrorMessage(error)}`,
        { cause: error }
      );
    }

    return this.normalize(parsed);
  }

  private async writeUnlocked(data: T): Promise<void> {
    const fileDir = dirname(this.filePath);
    const tempPath = join(
      fileDir,
      `.${basename(this.filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    );

    await mkdir(fileDir, { recursive: true });

    try {
      await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

async function withFileLock<T>(lockKey: string, action: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const next = previous.catch(() => undefined).then(() => current);
  fileLocks.set(lockKey, next);

  await previous.catch(() => undefined);

  try {
    return await action();
  } finally {
    release();
    if (fileLocks.get(lockKey) === next) {
      fileLocks.delete(lockKey);
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
