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
import {
  CasperCliX402SettlementProvider,
  DisabledX402SettlementProvider,
  FacilitatorX402SettlementProvider,
  HttpX402SigningProvider,
  ResourceRetryX402SettlementProvider,
  type X402SettlementProvider
} from "./x402/settlement.js";

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
    createX402SettlementProvider(config)
  );

  registerMemoryTools(server, memoryService);
  registerGrimoireTools(server, grimoireService);
  registerPaymentTools(server, paymentService);
  registerAuditTools(server, auditService);

  return server;
}

function createX402SettlementProvider(config: SigilConfig): X402SettlementProvider {
  if (!config.x402.settlementEnabled) {
    return new DisabledX402SettlementProvider("x402_settlement_disabled");
  }

  if (!config.x402.signerUrl) {
    return new DisabledX402SettlementProvider("x402_signing_provider_not_configured");
  }

  const signer = new HttpX402SigningProvider({
    signerUrl: config.x402.signerUrl,
    authToken: config.x402.signerAuthToken,
    timeoutMs: config.x402.signerTimeoutMs
  });

  if (config.x402.settlementMode === "facilitator") {
    return new FacilitatorX402SettlementProvider(signer);
  }

  if (config.x402.settlementMode === "casper-cli") {
    return new CasperCliX402SettlementProvider(signer, {
      networkName: config.casper.networkName,
      caip2ChainId: config.casper.caip2ChainId,
      rpcUrl: config.casper.rpcUrl,
      accountKeyPath: config.casper.accountKeyPath,
      submissionEnabled: config.casper.submissionEnabled,
      clientBin: config.casper.clientBin,
      clientWslDistro: config.casper.clientWslDistro,
      gasPriceTolerance: config.casper.gasPriceTolerance,
      pricingMode: config.casper.pricingMode,
      paymentAmountMotes: config.x402.casperSettlementPaymentAmountMotes,
      confirmationPollIntervalMs: config.x402.casperConfirmationPollIntervalMs,
      confirmationTimeoutMs: config.x402.casperConfirmationTimeoutMs
    });
  }

  return new ResourceRetryX402SettlementProvider(signer, undefined, {
    paymentHeaderName: config.x402.paymentHeaderName
  });
}
