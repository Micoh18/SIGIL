import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalEnvFile } from "../src/env-file.js";

describe("local env file loader", () => {
  it("loads an explicit env file without overriding existing process values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mainspring-env-"));
    const envPath = join(dir, ".env");
    const env: NodeJS.ProcessEnv = {
      SIGIL_ENV_FILE: envPath,
      PROJECT_URL: "https://already-set.example"
    };

    await writeFile(
      envPath,
      [
        "# comment",
        "PROJECT_URL=https://from-file.example",
        "SECRET_KEY='secret-value'",
        'SIGIL_STORAGE_BACKEND="supabase"',
        "INVALID-NAME=ignored"
      ].join("\n"),
      "utf8"
    );

    expect(loadLocalEnvFile(env)).toBe(envPath);
    expect(env.PROJECT_URL).toBe("https://already-set.example");
    expect(env.SECRET_KEY).toBe("secret-value");
    expect(env.SIGIL_STORAGE_BACKEND).toBe("supabase");
    expect(env["INVALID-NAME"]).toBeUndefined();
  });

  it("returns null when an explicit env file does not exist", () => {
    const env: NodeJS.ProcessEnv = {
      SIGIL_ENV_FILE: join(tmpdir(), "missing-mainspring.env")
    };

    expect(loadLocalEnvFile(env)).toBeNull();
  });
});
