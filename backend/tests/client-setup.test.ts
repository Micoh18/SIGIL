import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";
import { setupAllClients, formatClientSetupReport } from "../src/client-setup.js";

async function makeTmpHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mainspring-client-setup-"));
}

function claudeConfigPath(home: string): string {
  if (process.platform === "win32") {
    return join(home, "appdata", "Claude", "claude_desktop_config.json");
  }

  if (process.platform === "linux") {
    return join(home, ".config", "Claude", "claude_desktop_config.json");
  }

  return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

describe("setupAllClients", () => {
  it("returns not-installed for clients whose parent dir does not exist", async () => {
    const home = await makeTmpHome();
    const env: NodeJS.ProcessEnv = { HOME: home, APPDATA: join(home, "appdata"), USERPROFILE: home };
    const results = setupAllClients(env);
    expect(results.every(r => r.status === "not-installed")).toBe(true);
  });

  it("writes standard MCP config when Claude Desktop dir exists but file absent", async () => {
    const home = await makeTmpHome();
    const configPath = claudeConfigPath(home);
    await mkdir(dirname(configPath), { recursive: true });

    const env: NodeJS.ProcessEnv = {
      HOME: home,
      APPDATA: join(home, "appdata"),
      USERPROFILE: home
    };

    const results = setupAllClients(env);
    const claude = results.find(
      r => r.name === "Claude Desktop" && normalize(r.configPath) === normalize(configPath)
    );
    expect(claude?.status).toBe("written");

    const { readFileSync } = await import("node:fs");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.mcpServers.mainspring.command).toBe("npx");
    expect(written.mcpServers.mainspring.args).toEqual(["-y", "mrmainspring"]);
  });

  it("merges into existing config without overwriting other servers", async () => {
    const home = await makeTmpHome();
    const configPath = claudeConfigPath(home);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      mcpServers: { "other-server": { command: "other" } }
    }, null, 2), "utf8");

    const env: NodeJS.ProcessEnv = { HOME: home, APPDATA: join(home, "appdata"), USERPROFILE: home };
    setupAllClients(env);

    const { readFileSync } = await import("node:fs");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.mcpServers["other-server"].command).toBe("other");
    expect(written.mcpServers.mainspring.command).toBe("npx");
  });

  it("reports already-set when mainspring entry already exists", async () => {
    const home = await makeTmpHome();
    const configPath = claudeConfigPath(home);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      mcpServers: { mainspring: { command: "npx", args: ["-y", "mrmainspring"] } }
    }, null, 2), "utf8");

    const env: NodeJS.ProcessEnv = { HOME: home, APPDATA: join(home, "appdata"), USERPROFILE: home };
    const results = setupAllClients(env);
    const claude = results.find(
      r => r.name === "Claude Desktop" && normalize(r.configPath) === normalize(configPath)
    );
    expect(claude?.status).toBe("already-set");
  });

  it("writes Zed context_servers format", async () => {
    if (process.platform === "win32") {
      return;
    }

    const home = await makeTmpHome();
    const zedDir = join(home, ".config", "zed");
    await mkdir(zedDir, { recursive: true });
    const configPath = join(zedDir, "settings.json");
    await writeFile(configPath, JSON.stringify({ vim_mode: true }), "utf8");

    const env: NodeJS.ProcessEnv = { HOME: home, APPDATA: join(home, "appdata"), USERPROFILE: home };
    setupAllClients(env);

    const { readFileSync } = await import("node:fs");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.vim_mode).toBe(true);
    expect(written.context_servers.mainspring.command.path).toBe("npx");
    expect(written.context_servers.mainspring.command.args).toEqual(["-y", "mrmainspring"]);
  });

  it("writes Continue.dev array format", async () => {
    const home = await makeTmpHome();
    const continueDir = join(home, ".continue");
    await mkdir(continueDir, { recursive: true });
    const configPath = join(continueDir, "config.json");
    await writeFile(configPath, JSON.stringify({ mcpServers: [{ name: "other", command: "x" }] }), "utf8");

    const env: NodeJS.ProcessEnv = { HOME: home, APPDATA: join(home, "appdata"), USERPROFILE: home };
    setupAllClients(env);

    const { readFileSync } = await import("node:fs");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.mcpServers).toHaveLength(2);
    const ms = written.mcpServers.find((s: { name: string }) => s.name === "mainspring");
    expect(ms.command).toBe("npx");
    expect(ms.args).toEqual(["-y", "mrmainspring"]);
    expect(written.mcpServers.find((s: { name: string }) => s.name === "other").command).toBe("x");
  });
});

describe("formatClientSetupReport", () => {
  it("returns empty string when all not-installed", () => {
    const results = [
      { name: "A", configPath: "/a", status: "not-installed" as const },
      { name: "B", configPath: "/b", status: "not-installed" as const },
    ];
    expect(formatClientSetupReport(results)).toBe("");
  });

  it("includes written and already-set entries", () => {
    const results = [
      { name: "Claude Desktop", configPath: "/x/claude.json", status: "written" as const },
      { name: "Cursor", configPath: "/x/cursor.json", status: "already-set" as const },
      { name: "Zed", configPath: "/x/zed.json", status: "not-installed" as const },
    ];
    const report = formatClientSetupReport(results);
    expect(report).toContain("Claude Desktop");
    expect(report).toContain("Cursor");
    expect(report).not.toContain("Zed");
    expect(report).toContain("Restart");
  });
});
