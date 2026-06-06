import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureGrimoireMasterKey, loadLocalEnvFile } from "../src/env-file.js";
import { getDefaultMainspringPaths } from "../src/paths.js";

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

  it("creates a missing explicit env file before writing the generated master key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mainspring-env-missing-parent-"));
    const envPath = join(dir, "nested", ".env");
    const env: NodeJS.ProcessEnv = {
      SIGIL_ENV_FILE: envPath
    };

    ensureGrimoireMasterKey(env);

    const raw = await readFile(envPath, "utf8");
    expect(raw).toMatch(/^GRIMOIRE_MASTER_KEY=[A-Za-z0-9+/=]+\n$/);
    expect(env.GRIMOIRE_MASTER_KEY).toBeTruthy();
  });

  it("builds platform default paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mainspring-paths-"));
    const env: NodeJS.ProcessEnv = {
      XDG_CONFIG_HOME: join(dir, "xdg")
    };
    const paths = getDefaultMainspringPaths(env, "linux", dir);

    expect(paths.appDir).toBe(join(dir, "xdg", "mrmainspring"));
    expect(paths.envFile).toBe(join(paths.appDir, ".env"));
  });
});
