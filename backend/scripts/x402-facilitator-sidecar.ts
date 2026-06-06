import { once } from "node:events";
import { loadConfig } from "../src/config.js";
import { createX402FacilitatorHttpServer } from "../src/x402/facilitator.js";

const host = optionalEnv(process.env.X402_FACILITATOR_HOST) ?? "127.0.0.1";
const port = parsePort(process.env.X402_FACILITATOR_PORT, 4022);
const config = loadConfig();

const server = createX402FacilitatorHttpServer({
  facilitatorUrl: config.x402.facilitatorUrl,
  settlementConfig: {
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
  },
  logger: console
});

server.listen(port, host);
await once(server, "listening");

const address = server.address();
if (typeof address === "object" && address) {
  console.log(`x402 facilitator sidecar: http://${address.address}:${address.port}`);
} else {
  console.log(`x402 facilitator sidecar: http://${host}:${port}`);
}
console.log("x402 facilitator endpoints: POST /verify, POST /settle");
console.log("Press Ctrl+C to stop.");

function optionalEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parsePort(value: string | undefined, fallback: number): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid X402_FACILITATOR_PORT: ${normalized}`);
  }

  return parsed;
}
