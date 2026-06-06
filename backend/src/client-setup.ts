import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

export type ClientSetupResult = {
  name: string;
  configPath: string;
  status: "written" | "already-set" | "not-installed" | "error";
  error?: string;
};

export type ClientDetection = {
  name: string;
  configPath: string;
  installed: boolean;
  format: "standard" | "zed" | "continue";
};

const MAINSPRING_ENTRY = {
  command: "npx",
  args: ["-y", "mrmainspring"]
};

type ClientDef = {
  name: string;
  path: string;
  platforms: string[];
  format: "standard" | "zed" | "continue";
};

const CLIENTS: ClientDef[] = [
  // Claude Desktop
  { name: "Claude Desktop", path: "~/Library/Application Support/Claude/claude_desktop_config.json", platforms: ["darwin"], format: "standard" },
  { name: "Claude Desktop", path: "%APPDATA%/Claude/claude_desktop_config.json", platforms: ["win32"], format: "standard" },
  { name: "Claude Desktop", path: "~/.config/Claude/claude_desktop_config.json", platforms: ["linux"], format: "standard" },
  // Claude Code CLI
  { name: "Claude Code", path: "~/.claude/settings.json", platforms: ["darwin", "linux", "win32"], format: "standard" },
  // Cursor
  { name: "Cursor", path: "~/.cursor/mcp.json", platforms: ["darwin", "linux"], format: "standard" },
  { name: "Cursor", path: "%USERPROFILE%/.cursor/mcp.json", platforms: ["win32"], format: "standard" },
  // Windsurf
  { name: "Windsurf", path: "~/.codeium/windsurf/mcp_config.json", platforms: ["darwin", "linux", "win32"], format: "standard" },
  // Windsurf (also on Windows via AppData)
  { name: "Windsurf", path: "%APPDATA%/Windsurf/User/globalStorage/codeium.windsurf/mcp_config.json", platforms: ["win32"], format: "standard" },
  // Zed
  { name: "Zed", path: "~/.config/zed/settings.json", platforms: ["darwin", "linux"], format: "zed" },
  // Continue.dev
  { name: "Continue", path: "~/.continue/config.json", platforms: ["darwin", "linux", "win32"], format: "continue" },
  // VS Code (workspace-agnostic user MCP config — requires MCP extension)
  { name: "VS Code", path: "~/.vscode/mcp.json", platforms: ["darwin", "linux", "win32"], format: "standard" },
];

function expandPath(p: string, env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return p
    .replace(/^~/, home)
    .replace(/%APPDATA%/gi, env.APPDATA ?? "")
    .replace(/%USERPROFILE%/gi, env.USERPROFILE ?? home);
}

function isInstalled(configPath: string): boolean {
  return existsSync(dirname(configPath)) || existsSync(configPath);
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

function alreadySet(json: Record<string, unknown>, format: "standard" | "zed" | "continue"): boolean {
  if (format === "zed") {
    return !!(json.context_servers as Record<string, unknown> | undefined)?.mainspring;
  }
  if (format === "continue") {
    const servers = json.mcpServers as Array<{ name?: string }> | undefined;
    return !!servers?.some(s => s.name === "mainspring");
  }
  return !!(json.mcpServers as Record<string, unknown> | undefined)?.mainspring;
}

function mergeConfig(json: Record<string, unknown>, format: "standard" | "zed" | "continue"): Record<string, unknown> {
  if (format === "zed") {
    return {
      ...json,
      context_servers: {
        ...(json.context_servers as Record<string, unknown> | undefined ?? {}),
        mainspring: { command: { path: "npx", args: ["-y", "mrmainspring"] } }
      }
    };
  }
  if (format === "continue") {
    const existing = (json.mcpServers as Array<Record<string, unknown>> | undefined ?? [])
      .filter((s: Record<string, unknown>) => s.name !== "mainspring");
    return {
      ...json,
      mcpServers: [...existing, { name: "mainspring", command: "npx", args: ["-y", "mrmainspring"] }]
    };
  }
  return {
    ...json,
    mcpServers: {
      ...(json.mcpServers as Record<string, unknown> | undefined ?? {}),
      mainspring: MAINSPRING_ENTRY
    }
  };
}

export function detectClients(env: NodeJS.ProcessEnv = process.env): ClientDetection[] {
  const plat = process.platform;
  const seen = new Set<string>();
  const results: ClientDetection[] = [];

  for (const client of CLIENTS) {
    if (!client.platforms.includes(plat)) continue;
    const configPath = expandPath(client.path, env);
    const key = `${client.name}:${configPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ name: client.name, configPath, installed: isInstalled(configPath), format: client.format });
  }

  return results;
}

export function configureClients(
  selected: ClientDetection[],
  env: NodeJS.ProcessEnv = process.env
): ClientSetupResult[] {
  const results: ClientSetupResult[] = [];

  for (const client of selected) {
    if (!client.installed) {
      results.push({ name: client.name, configPath: client.configPath, status: "not-installed" });
      continue;
    }
    try {
      const json = readJson(client.configPath);
      if (alreadySet(json, client.format)) {
        results.push({ name: client.name, configPath: client.configPath, status: "already-set" });
        continue;
      }
      mkdirSync(dirname(client.configPath), { recursive: true });
      writeFileSync(client.configPath, JSON.stringify(mergeConfig(json, client.format), null, 2) + "\n", "utf8");
      results.push({ name: client.name, configPath: client.configPath, status: "written" });
    } catch (e) {
      results.push({ name: client.name, configPath: client.configPath, status: "error", error: String(e) });
    }
  }

  return results;
}

export function setupAllClients(env: NodeJS.ProcessEnv = process.env): ClientSetupResult[] {
  const plat = process.platform;
  const results: ClientSetupResult[] = [];
  const seen = new Set<string>();

  for (const client of CLIENTS) {
    if (!client.platforms.includes(plat)) continue;
    const configPath = expandPath(client.path, env);
    const key = `${client.name}:${configPath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!isInstalled(configPath)) {
      results.push({ name: client.name, configPath, status: "not-installed" });
      continue;
    }

    try {
      const json = readJson(configPath);
      if (alreadySet(json, client.format)) {
        results.push({ name: client.name, configPath, status: "already-set" });
        continue;
      }
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(mergeConfig(json, client.format), null, 2) + "\n", "utf8");
      results.push({ name: client.name, configPath, status: "written" });
    } catch (e) {
      results.push({ name: client.name, configPath, status: "error", error: String(e) });
    }
  }

  return results;
}

export function formatClientSetupReport(results: ClientSetupResult[]): string {
  const active = results.filter(r => r.status !== "not-installed");
  if (active.length === 0) return "";

  const lines = ["\nMCP clients configured:"];
  for (const r of active) {
    if (r.status === "written") lines.push(`  [ok] ${r.name} → ${r.configPath}`);
    else if (r.status === "already-set") lines.push(`  [ok] ${r.name} → already configured`);
    else lines.push(`  [warn] ${r.name} → ${r.error}`);
  }
  lines.push("\nRestart any open MCP clients to load the server.");
  return lines.join("\n") + "\n";
}
