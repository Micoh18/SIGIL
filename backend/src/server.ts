import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SigilConfig } from "./config.js";
import { registerMemoryTools } from "./mcp/memoryTools.js";
import { MemoryService } from "./memory/service.js";
import { FileMemoryStore } from "./memory/store.js";

export function createSigilServer(config: SigilConfig): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion
  });

  const memoryService = new MemoryService(new FileMemoryStore(config.dataDir));
  registerMemoryTools(server, memoryService);

  return server;
}
