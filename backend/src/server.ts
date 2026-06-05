import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SigilConfig } from "./config.js";
import { GrimoireService } from "./grimoire/service.js";
import { FileGrimoireStore } from "./grimoire/store.js";
import { registerGrimoireTools } from "./mcp/grimoireTools.js";
import { registerMemoryTools } from "./mcp/memoryTools.js";
import { registerPaymentTools } from "./mcp/paymentTools.js";
import { MemoryService } from "./memory/service.js";
import { FileMemoryStore } from "./memory/store.js";
import { PaymentService } from "./payments/service.js";

export function createSigilServer(config: SigilConfig): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion
  });

  const memoryService = new MemoryService(new FileMemoryStore(config.dataDir));
  const grimoireService = new GrimoireService(
    new FileGrimoireStore(config.dataDir),
    config.grimoireMasterKey
  );
  const paymentService = new PaymentService(grimoireService);

  registerMemoryTools(server, memoryService);
  registerGrimoireTools(server, grimoireService);
  registerPaymentTools(server, paymentService);

  return server;
}
