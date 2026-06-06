import { once } from "node:events";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditService } from "../src/audit/service.js";
import { loadConfig } from "../src/config.js";
import type { SigilConfig } from "../src/config.js";
import { loadLocalEnvFile } from "../src/env-file.js";
import { GrimoireService } from "../src/grimoire/service.js";
import type { JsonObject } from "../src/memory/types.js";
import { PaymentService } from "../src/payments/service.js";
import { createX402SettlementProvider } from "../src/server.js";
import { createBackendStores } from "../src/storage/store-factory.js";
import { X402ChallengeClient } from "../src/x402/client.js";
import { createX402FacilitatorHttpServer } from "../src/x402/facilitator.js";
import { createX402PaidResourceHttpServer } from "../src/x402/resource.js";
import {
  createX402SignerHttpServer,
  loadCasperSigningKeyFromFile
} from "../src/x402/signer.js";

type DemoContext = {
  config: SigilConfig;
  audit: AuditService;
  grimoire: GrimoireService;
  payment: PaymentService;
};

type DemoRequestBody = {
  agent?: string;
  action?: string;
  rationale?: string;
};

type StartedServer = {
  label: string;
  server: Server;
};

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(backendRoot);
const isRender = parseBoolean(process.env.RENDER, false);
const host = optionalEnv(process.env.X402_DEMO_HTTP_HOST) ?? (isRender ? "0.0.0.0" : "127.0.0.1");
const port = parsePort(process.env.X402_DEMO_HTTP_PORT ?? process.env.PORT, 4180);
const startedServers: StartedServer[] = [];
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

loadLocalEnvFile();

const config = loadConfig();
assertRealSettlementConfig(config);

if (parseBoolean(process.env.X402_DEMO_START_SIDECARS, true)) {
  for (const starter of [startFacilitator, startSigner, startResource]) {
    const started = await starter(config);
    if (started) {
      startedServers.push(started);
    }
  }
}

const stores = createBackendStores(config);
const audit = new AuditService(stores.audit);
const grimoire = new GrimoireService(stores.grimoire, config.grimoireMasterKey, audit);
const payment = new PaymentService(
  grimoire,
  stores.payments,
  audit,
  new X402ChallengeClient({
    facilitatorUrl: config.x402.facilitatorUrl,
    resourceUrl: config.x402.resourceDemoUrl
  }),
  createX402SettlementProvider(config)
);
const context: DemoContext = {
  config,
  audit,
  grimoire,
  payment
};

const server = createServer(async (request, response) => {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        resource_url: config.x402.resourceDemoUrl,
        settlement_mode: config.x402.settlementMode
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/demo/x402/payment-fetch") {
      const body = await readJsonBody<DemoRequestBody>(request);
      const result = await runPaymentFetchDemo(context, body);
      sendJson(response, result.ok ? 200 : 502, result);
      return;
    }

    sendJson(response, 404, { ok: false, error: "not_found" });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: "demo_failed",
      message: errorMessage(error)
    });
  }
});

server.listen(port, host);
await once(server, "listening");
const publicDemoUrl = demoPublicUrl();
console.log(`Mr Mainspring x402 demo API: ${publicDemoUrl}`);
console.log(`POST ${publicDemoUrl}/demo/x402/payment-fetch`);
startRenderKeepalive();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await shutdown();
    process.exit(0);
  });
}

async function runPaymentFetchDemo(context: DemoContext, body: DemoRequestBody) {
  const input = normalizeDemoInput(body);
  const policyId = `pol-front-x402-${Date.now()}`;
  const idempotencyKey = `front-x402-${Date.now()}`;
  const amount = resourceAmount();
  const payTo = resourcePayTo();
  const asset = resourceAsset(context.config);

  await context.grimoire.setPolicy({
    agent_id: input.agentId,
    policy_id: policyId,
    enabled: true,
    allowed_urls: [context.config.x402.resourceDemoUrl],
    allowed_methods: ["GET"],
    allowed_asset: {
      caip2_chain_id: context.config.casper.caip2ChainId,
      asset,
      pay_to: payTo,
      scheme: "exact"
    },
    max_amount_per_call: amount,
    max_amount_per_period: multiplyUnsignedInteger(amount, 10n),
    period_seconds: 86_400,
    secret_scopes: ["x402:sign"]
  });

  const beforePolicy = await context.grimoire.getPolicy(input.agentId, policyId);
  const spendBefore = beforePolicy?.current_period_spend ?? "0";

  await context.payment.fetch({
    agent_id: input.agentId,
    policy_id: policyId,
    method: "GET",
    url: context.config.x402.resourceDemoUrl,
    expected_amount: amount,
    idempotency_key: `${idempotencyKey}-preflight`,
    request_challenge: false
  });

  const afterPreflightPolicy = await context.grimoire.getPolicy(input.agentId, policyId);
  const spendAfterPreflight = afterPreflightPolicy?.current_period_spend ?? "0";

  const fetchResult = await context.payment.fetch({
    agent_id: input.agentId,
    policy_id: policyId,
    method: "GET",
    url: context.config.x402.resourceDemoUrl,
    expected_amount: amount,
    idempotency_key: idempotencyKey,
    request_challenge: true
  });

  const paymentId = fetchResult.payment_id;
  const receiptResult = await context.payment.receipt(paymentId);
  const afterSettlementPolicy = await context.grimoire.getPolicy(input.agentId, policyId);
  const auditTail = await context.audit.tail({ agent_id: input.agentId, limit: 80 });
  const auditEvents = auditTail.events
    .filter((event) =>
      [
        "payment.challenge_received",
        "payment.settled",
        "payment.settlement_unavailable",
        "policy.spend_recorded"
      ].includes(event.event_type)
    )
    .map((event) => ({
      event_type: event.event_type,
      severity: event.severity,
      created_at: event.created_at
    }));

  const settled = fetchResult.allowed && fetchResult.status === "settled";
  return {
    ok: settled,
    decision: {
      agent: input.agentId,
      action: input.action,
      rationale_hash: `sha256:${hashLike(input.rationale)}`
    },
    resource_url: context.config.x402.resourceDemoUrl,
    payment_id: paymentId,
    policy_id: policyId,
    status: fetchResult.status,
    settlement: fetchResult.allowed ? fetchResult.settlement : "denied",
    settlement_blocker: fetchResult.allowed ? fetchResult.settlement_blocker ?? null : fetchResult.reason,
    challenge_status: fetchResult.allowed ? fetchResult.challenge?.status ?? null : null,
    receipt: receiptResult.receipt
      ? {
          settlement_status: receiptResult.receipt.settlement_status,
          casper_transaction_hash: receiptResult.receipt.casper_transaction_hash,
          response_hash: receiptResult.receipt.response_hash,
          response_status: receiptResult.receipt.response_status
        }
      : null,
    spend: {
      before: spendBefore,
      after_preflight: spendAfterPreflight,
      after_settlement: afterSettlementPolicy?.current_period_spend ?? spendAfterPreflight
    },
    audit_events: auditEvents,
    settled_at: new Date().toISOString()
  };
}

async function startFacilitator(config: SigilConfig): Promise<StartedServer | null> {
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
  return (await listenAtUrl(server, config.x402.facilitatorUrl, "x402 facilitator"))
    ? { label: "x402 facilitator", server }
    : null;
}

async function startSigner(config: SigilConfig): Promise<StartedServer | null> {
  assert(config.x402.signerUrl, "X402_SIGNER_URL is required");
  const buyerKeyPath =
    optionalEnv(process.env.X402_BUYER_PRIVATE_KEY_PATH) ??
    optionalEnv(process.env.CASPER_ACCOUNT_KEY_PATH) ??
    config.casper.accountKeyPath;
  assert(buyerKeyPath, "X402_BUYER_PRIVATE_KEY_PATH or CASPER_ACCOUNT_KEY_PATH is required");
  const server = createX402SignerHttpServer({
    signingKey: loadCasperSigningKeyFromFile(resolveLocalPath(buyerKeyPath)),
    buyerAccountHash: requiredEnv("X402_BUYER_ACCOUNT_HASH", process.env.X402_BUYER_ACCOUNT_HASH),
    authToken: config.x402.signerAuthToken,
    maxValiditySeconds: parsePositiveInteger(process.env.X402_SIGNER_MAX_VALIDITY_SECONDS, 900),
    logger: console
  });
  return (await listenAtUrl(server, config.x402.signerUrl, "x402 signer"))
    ? { label: "x402 signer", server }
    : null;
}

async function startResource(config: SigilConfig): Promise<StartedServer | null> {
  const resourceUrl = new URL(config.x402.resourceDemoUrl);
  const paymentRequirements = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: config.casper.caip2ChainId,
        maxAmountRequired: resourceAmount(),
        amount: resourceAmount(),
        resource: config.x402.resourceDemoUrl,
        method: "GET",
        asset: resourceAsset(config),
        payTo: resourcePayTo(),
        maxTimeoutSeconds: parsePositiveInteger(
          process.env.X402_RESOURCE_TIMEOUT_SECONDS ?? process.env.X402_SIGNER_MAX_VALIDITY_SECONDS,
          60
        ),
        description: "Casper x402 paid weather resource"
      }
    ],
    facilitator: config.x402.facilitatorUrl
  };
  const server = createX402PaidResourceHttpServer({
    resourcePath: resourceUrl.pathname || "/weather",
    facilitatorUrl: config.x402.facilitatorUrl,
    paymentRequirements,
    paymentHeaderName: config.x402.paymentHeaderName,
    logger: console
  });
  return (await listenAtUrl(server, config.x402.resourceDemoUrl, "x402 paid resource"))
    ? { label: "x402 paid resource", server }
    : null;
}

async function listenAtUrl(server: Server, url: string, label: string): Promise<boolean> {
  const parsed = new URL(url);
  const listenPort = Number(parsed.port);
  assert(
    Number.isInteger(listenPort) && listenPort > 0,
    `${label} URL must include an explicit port`
  );

  try {
    await new Promise<void>((resolveListen, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(listenPort, parsed.hostname, () => {
        server.off("error", onError);
        console.log(`${label}: ${url}`);
        resolveListen();
      });
    });
    return true;
  } catch (error) {
    if (isAddressInUse(error) && parseBoolean(process.env.X402_DEMO_USE_RUNNING_SIDECARS, true)) {
      console.log(`${label}: using already-running service at ${url}`);
      return false;
    }
    throw error;
  }
}

async function shutdown(): Promise<void> {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }

  if (server.listening) {
    server.close();
    await once(server, "close");
  }

  while (startedServers.length > 0) {
    const started = startedServers.pop()!;
    if (started.server.listening) {
      started.server.close();
      await once(started.server, "close");
      console.log(`${started.label}: stopped`);
    }
  }
}

function normalizeDemoInput(body: DemoRequestBody) {
  const agent = cleanText(body.agent, "front-agent-demo");
  return {
    agentId: agent.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80) || "front-agent-demo",
    action: cleanText(body.action, "Run x402 settlement demo").slice(0, 180),
    rationale: cleanText(body.rationale, "User-triggered frontend demo").slice(0, 500)
  };
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function setCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolveRead, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolveRead(raw.trim() ? (JSON.parse(raw) as T) : ({} as T));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function assertRealSettlementConfig(config: SigilConfig): void {
  assert(config.x402.settlementEnabled, "X402_ENABLE_REAL_SETTLEMENT must be true");
  assert(config.x402.settlementMode === "resource-retry", "X402_SETTLEMENT_MODE must be resource-retry");
  assert(config.x402.signerUrl, "X402_SIGNER_URL is required");
  assert(config.casper.submissionEnabled, "CASPER_ENABLE_REAL_SUBMISSION must be true");
  assert(config.casper.rpcUrl, "CASPER_RPC_URL is required");
  assert(config.casper.accountKeyPath, "CASPER_ACCOUNT_KEY_PATH is required");
}

function resourceAmount(): string {
  const amount =
    optionalEnv(process.env.X402_RESOURCE_AMOUNT) ??
    optionalEnv(process.env.X402_RESOURCE_AMOUNT_MOTES) ??
    "2500000000";
  assert(/^(0|[1-9]\d*)$/.test(amount), "X402_RESOURCE_AMOUNT must be an unsigned integer");
  return amount;
}

function resourceAsset(config: SigilConfig): string {
  return optionalEnv(process.env.X402_ASSET_ID) ?? config.x402.assetPackage ?? "casper-native-cspr";
}

function resourcePayTo(): string {
  return requiredEnv(
    "X402_PAY_TO",
    process.env.X402_PAY_TO ?? process.env.X402_PAYEE_PUBLIC_KEY ?? process.env.X402_PAYEE_ACCOUNT_HASH
  );
}

function multiplyUnsignedInteger(value: string, multiplier: bigint): string {
  return (BigInt(value) * multiplier).toString();
}

function parsePort(value: string | undefined, fallback: number): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = Number(normalized);
  assert(Number.isInteger(parsed) && parsed > 0 && parsed <= 65535, `Invalid port: ${normalized}`);
  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = Number(normalized);
  assert(Number.isInteger(parsed) && parsed > 0, `Invalid positive integer: ${normalized}`);
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = optionalEnv(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function demoPublicUrl(): string {
  const renderExternalUrl = optionalEnv(process.env.RENDER_EXTERNAL_URL);
  if (renderExternalUrl) {
    return renderExternalUrl.replace(/\/+$/, "");
  }

  return `http://${host}:${port}`;
}

function startRenderKeepalive(): void {
  const enabled = parseBoolean(process.env.RENDER_KEEPALIVE_ENABLED, isRender);
  if (!enabled) {
    return;
  }

  const target = keepaliveUrl();
  if (!target) {
    console.warn("Render keepalive disabled: set RENDER_EXTERNAL_URL or RENDER_KEEPALIVE_URL");
    return;
  }

  const intervalMs = parsePositiveInteger(
    process.env.RENDER_KEEPALIVE_INTERVAL_MS,
    14 * 60 * 1000
  );
  keepaliveTimer = setInterval(() => {
    void pingKeepalive(target);
  }, intervalMs);
  keepaliveTimer.unref?.();
  console.log(`Render keepalive: GET ${target} every ${Math.round(intervalMs / 1000)}s`);
}

function keepaliveUrl(): string | null {
  const configured = optionalEnv(process.env.RENDER_KEEPALIVE_URL);
  if (configured) {
    return configured;
  }

  const renderExternalUrl = optionalEnv(process.env.RENDER_EXTERNAL_URL);
  if (!renderExternalUrl) {
    return null;
  }

  return `${renderExternalUrl.replace(/\/+$/, "")}/health`;
}

async function pingKeepalive(target: string): Promise<void> {
  try {
    const response = await fetch(target, {
      method: "GET",
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      console.warn(`Render keepalive returned HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn(`Render keepalive failed: ${errorMessage(error)}`);
  }
}

function hashLike(value: string): string {
  let state = 0x811c9dc5 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return state.toString(16).padStart(8, "0");
}

function resolveLocalPath(value: string): string {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

function requiredEnv(name: string, value: string | undefined): string {
  const normalized = optionalEnv(value);
  assert(normalized, `${name} is required`);
  return normalized;
}

function optionalEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isAddressInUse(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "EADDRINUSE"
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
