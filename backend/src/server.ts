import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuditService } from "./audit/service.js";
import { FileAuditStore } from "./audit/store.js";
import type { SigilConfig } from "./config.js";
import { GrimoireService } from "./grimoire/service.js";
import { FileGrimoireStore } from "./grimoire/store.js";
import { registerAuditTools } from "./mcp/auditTools.js";
import { registerGrimoireTools } from "./mcp/grimoireTools.js";
import { registerMemoryTools } from "./mcp/memoryTools.js";
import { registerPaymentTools } from "./mcp/paymentTools.js";
import { MemoryService } from "./memory/service.js";
import { FileMemoryStore } from "./memory/store.js";
import { PaymentService } from "./payments/service.js";
import { FilePaymentStore } from "./payments/store.js";

export function createSigilServer(config: SigilConfig): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion
  });

  const auditService = new AuditService(new FileAuditStore(config.dataDir));
  const memoryService = new MemoryService(new FileMemoryStore(config.dataDir), auditService);
  const grimoireService = new GrimoireService(
    new FileGrimoireStore(config.dataDir),
    config.grimoireMasterKey,
    auditService
  );
  const paymentService = new PaymentService(
    grimoireService,
    new FilePaymentStore(config.dataDir),
    auditService
  );

  registerMemoryTools(server, memoryService);
  registerGrimoireTools(server, grimoireService);
  registerPaymentTools(server, paymentService);
  registerAuditTools(server, auditService);

  return server;
}
