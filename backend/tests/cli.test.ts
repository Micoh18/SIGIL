import { describe, expect, it } from "vitest";
import { formatMcpConfig } from "../src/cli.js";

describe("CLI MCP config formatting", () => {
  it("prints JSON mcpServers by default", () => {
    const config = formatMcpConfig();

    expect(config).toContain('"mcpServers"');
    expect(config).toContain('"command": "npx"');
    expect(config).toContain('"mrmainspring"');
  });

  it("prints Codex TOML when requested", () => {
    const config = formatMcpConfig("codex");

    expect(config).toContain("[mcp_servers.mainspring]");
    expect(config).toContain('command = "npx"');
    expect(config).toContain('args = ["-y", "mrmainspring"]');
    expect(config).toContain("startup_timeout_sec = 20");
    expect(config).not.toContain("mcpServers");
  });
});
