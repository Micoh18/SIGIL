import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuditService } from "./audit/service.js";
import { createCasperAnchorClient } from "./casper/anchorClient.js";
import type { SigilConfig } from "./config.js";
import { GrimoireService } from "./grimoire/service.js";
import { registerAuditTools } from "./mcp/auditTools.js";
import { registerGrimoireTools } from "./mcp/grimoireTools.js";
import { registerMemoryTools } from "./mcp/memoryTools.js";
import { registerPaymentTools } from "./mcp/paymentTools.js";
import { MemoryService } from "./memory/service.js";
import { PaymentService } from "./payments/service.js";
import { createBackendStores } from "./storage/store-factory.js";
import { X402ChallengeClient } from "./x402/client.js";
import { DisabledX402SettlementProvider } from "./x402/settlement.js";

export function createSigilServer(config: SigilConfig): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion
  });

  const stores = createBackendStores(config);
  const auditService = new AuditService(stores.audit);
  const anchorClient = createCasperAnchorClient(config.casper);
  const memoryService = new MemoryService(
    stores.memory,
    auditService,
    anchorClient
  );
  const grimoireService = new GrimoireService(
    stores.grimoire,
    config.grimoireMasterKey,
    auditService
  );
  const paymentService = new PaymentService(
    grimoireService,
    stores.payments,
    auditService,
    new X402ChallengeClient({
      facilitatorUrl: config.x402.facilitatorUrl,
      resourceUrl: config.x402.resourceDemoUrl
    }),
    new DisabledX402SettlementProvider(
      config.x402.settlementEnabled
        ? "x402_signing_provider_not_configured"
        : "x402_settlement_disabled"
    )
  );

  registerMemoryTools(server, memoryService);
  registerGrimoireTools(server, grimoireService);
  registerPaymentTools(server, paymentService);
  registerAuditTools(server, auditService);

  return server;
}
