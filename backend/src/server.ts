import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SigilConfig } from "./config.js";

export function createSigilServer(config: SigilConfig): McpServer {
  return new McpServer({
    name: config.serverName,
    version: config.serverVersion
  });
}

