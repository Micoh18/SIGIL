import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultMainspringPaths } from "./paths.js";

export function loadLocalEnvFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const envPath = resolveEnvPath(env);
  if (!existsSync(envPath)) {
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

export function resolveEnvPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SIGIL_ENV_FILE?.trim()) {
    return resolve(env.SIGIL_ENV_FILE.trim());
  }

  const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = dirname(backendRoot);
  const defaultEnvFile = getDefaultMainspringPaths(env).envFile;
  const candidates = [
    defaultEnvFile,
    join(process.cwd(), ".env"),
    join(backendRoot, ".env"),
    join(repoRoot, ".env")
  ];

  return resolve(candidates.find((candidate) => existsSync(candidate)) ?? defaultEnvFile);
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

export function ensureGrimoireMasterKey(
  env: NodeJS.ProcessEnv = process.env,
  options: { announce?: boolean } = {}
): void {
  if (env.GRIMOIRE_MASTER_KEY) return;

  const key = randomBytes(32).toString("base64");
  const targetPath = resolveEnvPath(env);

  mkdirSync(dirname(targetPath), { recursive: true });
  const prefix = existsSync(targetPath) && readFileSync(targetPath, "utf8").trim() ? "\n" : "";
  appendFileSync(targetPath, `${prefix}GRIMOIRE_MASTER_KEY=${key}\n`, "utf8");
  env.GRIMOIRE_MASTER_KEY = key;

  if (options.announce !== false) {
    process.stderr.write(`[mr-mainspring] Generated GRIMOIRE_MASTER_KEY at ${targetPath}\n`);
  }
}

export function upsertLocalEnvFileValues(
  values: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): string {
  const targetPath = resolveEnvPath(env);
  mkdirSync(dirname(targetPath), { recursive: true });

  const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const remaining = new Map(Object.entries(values));
  const lines = existing.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !remaining.has(match[1]!)) {
      return line;
    }

    const key = match[1]!;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${quoteEnv(value)}`;
  });

  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  if (remaining.size > 0 && lines.length > 0 && lines.at(-1)?.trim()) {
    lines.push("");
  }

  for (const [key, value] of remaining) {
    lines.push(`${key}=${quoteEnv(value)}`);
  }

  writeFileSync(targetPath, `${lines.join("\n")}\n`, "utf8");

  for (const [key, value] of Object.entries(values)) {
    env[key] = value;
  }

  return targetPath;
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

function quoteEnv(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : `"${value.replace(/"/g, "")}"`;
}
