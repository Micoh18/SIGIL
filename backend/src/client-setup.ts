import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

export type ClientSetupResult = {
  name: string;
  configPath: string;
  status: "written" | "already-set" | "not-installed" | "error";
  error?: string;
};

const MAINSPRING_ENTRY = {
  command: "npx",
  args: ["-y", "mrmainspring"]
};

type ClientDef = {
  name: string;
  path: string;
  platforms: string[];
  format: "standard" | "zed";
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
  // Zed
  { name: "Zed", path: "~/.config/zed/settings.json", platforms: ["darwin", "linux"], format: "zed" },
];

function expandPath(p: string, env: NodeJS.ProcessEnv): string {
  return p
    .replace(/^~/, homedir())
    .replace(/%APPDATA%/gi, env.APPDATA ?? "")
    .replace(/%USERPROFILE%/gi, env.USERPROFILE ?? homedir());
}

function isInstalled(configPath: string): boolean {
  return existsSync(dirname(configPath)) || existsSync(configPath);
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

function alreadySet(json: Record<string, unknown>, format: "standard" | "zed"): boolean {
  if (format === "zed") {
    return !!(json.context_servers as Record<string, unknown> | undefined)?.mainspring;
  }
  return !!(json.mcpServers as Record<string, unknown> | undefined)?.mainspring;
}

function mergeConfig(json: Record<string, unknown>, format: "standard" | "zed"): Record<string, unknown> {
  if (format === "zed") {
    return {
      ...json,
      context_servers: {
        ...(json.context_servers as Record<string, unknown> | undefined ?? {}),
        mainspring: { command: { path: "npx", args: ["-y", "mrmainspring"] } }
      }
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
