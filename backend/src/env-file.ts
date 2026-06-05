import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnvFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const envPath = resolveEnvPath(env);
  if (!envPath || !existsSync(envPath)) {
    return null;
  }

  const raw = readFileSync(envPath, "utf8");
  for (const [key, value] of parseEnv(raw)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }

  return envPath;
}

function resolveEnvPath(env: NodeJS.ProcessEnv): string | null {
  if (env.SIGIL_ENV_FILE?.trim()) {
    return env.SIGIL_ENV_FILE.trim();
  }

  const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = dirname(backendRoot);
  const candidates = [join(process.cwd(), ".env"), join(backendRoot, ".env"), join(repoRoot, ".env")];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates.at(-1) ?? null;
}

function parseEnv(raw: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = unquote(trimmed.slice(separator + 1).trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      entries.push([key, value]);
    }
  }

  return entries;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
