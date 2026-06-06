import { once } from "node:events";
import type { Server } from "node:http";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "../src/config.js";
import { loadLocalEnvFile } from "../src/env-file.js";
import type { JsonObject } from "../src/memory/types.js";
import { createX402FacilitatorHttpServer } from "../src/x402/facilitator.js";
import { createX402PaidResourceHttpServer } from "../src/x402/resource.js";
import {
  createX402SignerHttpServer,
  loadCasperSigningKeyFromFile
} from "../src/x402/signer.js";

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

type SmokeServer = {
  label: string;
  server: Server;
};

type PolicyGetResult = {
  found: boolean;
  policy?: {
    current_period_spend: string;
  };
};

type PaymentFetchResult = {
  allowed: boolean;
  payment_id: string;
  status: string;
  settlement?: string;
  challenge?: {
    status: string;
  };
  settlement_blocker?: string;
};

type PaymentReceiptResult = {
  found: boolean;
  payment_id: string;
  intent?: {
    status: string;
    signed_payload_hash: string | null;
  };
  receipt?: {
    settlement_status: string;
    casper_transaction_hash: string | null;
    receipt_json: string;
  } | null;
};

type AuditTailResult = {
  count: number;
  events: Array<{
    event_type: string;
    metadata: JsonObject;
  }>;
};

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(backendRoot);

loadLocalEnvFile();

const requestOptions = {
  timeout: parsePositiveInteger(process.env.X402_SMOKE_MCP_TIMEOUT_MS, 240_000)
};

async function main(): Promise<void> {
  const config = loadConfig();
  assertRealSettlementConfig(config);

  const startSidecars = parseBoolean(process.env.X402_SMOKE_START_SIDECARS, true);
  const startedServers: SmokeServer[] = [];
  const stderrChunks: Buffer[] = [];
  const client = new Client({
    name: "mr-mainspring-x402-payment-fetch-smoke",
    version: "0.1.0"
  });

  try {
    if (startSidecars) {
      for (const starter of [startFacilitator, startSigner, startResource]) {
        const started = await starter(config);
        if (started) {
          startedServers.push(started);
        }
      }
    }

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(backendRoot, "src", "index.ts")
      ],
      cwd: backendRoot,
      env: stringEnv(process.env),
      stderr: "pipe"
    });
    transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    await client.connect(transport, requestOptions);

    const smoke = createSmokeInput(config);
    await callJsonTool(client, "grimoire.policy.set", {
      agent_id: smoke.agentId,
      policy_id: smoke.policyId,
      enabled: true,
      allowed_urls: [config.x402.resourceDemoUrl],
      allowed_methods: ["GET"],
      allowed_asset: {
        caip2_chain_id: config.casper.caip2ChainId,
        asset: smoke.asset,
        pay_to: smoke.payTo,
        scheme: "exact"
      },
      max_amount_per_call: smoke.amount,
      max_amount_per_period: smoke.maxAmountPerPeriod,
      period_seconds: smoke.periodSeconds,
      secret_scopes: ["x402:sign"]
    });

    const beforePolicy = await callJsonTool<PolicyGetResult>(client, "grimoire.policy.get", {
      agent_id: smoke.agentId,
      policy_id: smoke.policyId
    });
    assert(beforePolicy.found, "Grimoire policy was not persisted");
    const spendBefore = beforePolicy.policy!.current_period_spend;

    const preflight = await callJsonTool<PaymentFetchResult>(client, "payment.fetch", {
      agent_id: smoke.agentId,
      policy_id: smoke.policyId,
      method: "GET",
      url: config.x402.resourceDemoUrl,
      expected_amount: smoke.amount,
      idempotency_key: `${smoke.idempotencyKey}-preflight`,
      request_challenge: false
    });
    assert(preflight.allowed, "payment.fetch preflight was denied");
    assert(preflight.status === "policy_checked", `Expected policy_checked preflight, got ${preflight.status}`);

    const afterPreflightPolicy = await callJsonTool<PolicyGetResult>(
      client,
      "grimoire.policy.get",
      {
        agent_id: smoke.agentId,
        policy_id: smoke.policyId
      }
    );
    const spendAfterPreflight = afterPreflightPolicy.policy!.current_period_spend;
    assert(
      compareDecimalAmounts(spendAfterPreflight, spendBefore) === 0,
      `Policy spend changed before settlement: before=${spendBefore} after_preflight=${spendAfterPreflight}`
    );

    const settled = await callJsonTool<PaymentFetchResult>(client, "payment.fetch", {
      agent_id: smoke.agentId,
      policy_id: smoke.policyId,
      method: "GET",
      url: config.x402.resourceDemoUrl,
      expected_amount: smoke.amount,
      idempotency_key: smoke.idempotencyKey,
      request_challenge: true
    });
    assert(settled.allowed, "payment.fetch settlement call was denied");
    if (settled.status !== "settled" || settled.settlement !== "settled") {
      const failedReceipt = await callJsonTool<PaymentReceiptResult>(client, "payment.receipt", {
        payment_id: settled.payment_id
      });
      throw new Error(
        [
          `Expected settled payment.fetch, got status=${settled.status}`,
          `settlement=${settled.settlement ?? "<missing>"}`,
          `blocker=${settled.settlement_blocker ?? "<none>"}`,
          `receipt_status=${failedReceipt.receipt?.settlement_status ?? "<none>"}`,
          `receipt_tx=${failedReceipt.receipt?.casper_transaction_hash ?? "<none>"}`
        ].join(" ")
      );
    }
    assert(
      settled.challenge?.status === "payment_required",
      `Expected payment_required challenge, got ${settled.challenge?.status ?? "<missing>"}`
    );

    const receipt = await callJsonTool<PaymentReceiptResult>(client, "payment.receipt", {
      payment_id: settled.payment_id
    });
    assert(receipt.found, "payment.receipt did not find the settled payment");
    assert(receipt.intent?.status === "settled", `Receipt intent status is ${receipt.intent?.status}`);
    assertHex64("signed_payload_hash", receipt.intent?.signed_payload_hash ?? "");
    assert(receipt.receipt?.settlement_status === "settled", "Receipt is not marked settled");
    assertCasperTransactionHash(receipt.receipt?.casper_transaction_hash);
    assertNoSignedPayloadBody(JSON.parse(receipt.receipt!.receipt_json) as unknown);

    const afterSettlementPolicy = await callJsonTool<PolicyGetResult>(
      client,
      "grimoire.policy.get",
      {
        agent_id: smoke.agentId,
        policy_id: smoke.policyId
      }
    );
    const expectedSpend = addDecimalAmounts(spendBefore, smoke.amount);
    const spendAfterSettlement = afterSettlementPolicy.policy!.current_period_spend;
    assert(
      compareDecimalAmounts(spendAfterSettlement, expectedSpend) === 0,
      `Policy spend did not increment after settlement: expected=${expectedSpend} actual=${spendAfterSettlement}`
    );

    const audit = await callJsonTool<AuditTailResult>(client, "audit.tail", {
      agent_id: smoke.agentId,
      limit: 200
    });
    const eventTypes = audit.events.map((event) => event.event_type);
    for (const eventType of [
      "payment.challenge_received",
      "payment.settled",
      "policy.spend_recorded"
    ]) {
      assert(eventTypes.includes(eventType), `audit.tail missing ${eventType}`);
    }
    const settledAudit = audit.events.find((event) => event.event_type === "payment.settled");
    assertCasperTransactionHash(String(settledAudit?.metadata.casper_transaction_hash ?? ""));

    console.log("Mr Mainspring Casper x402 payment.fetch smoke");
    console.log(`resource=${config.x402.resourceDemoUrl}`);
    console.log(`policy_id=${smoke.policyId}`);
    console.log(
      `PASS payment.fetch: status=settled settlement=settled payment_id=${settled.payment_id}`
    );
    console.log(
      `PASS payment.receipt: settlement_status=settled casper_transaction_hash=${receipt.receipt!.casper_transaction_hash}`
    );
    console.log(
      `PASS policy.spend: before=${spendBefore} after_preflight=${spendAfterPreflight} after_settlement=${spendAfterSettlement}`
    );
    console.log(
      `PASS audit.tail: events=${[
        "payment.challenge_received",
        "payment.settled",
        "policy.spend_recorded"
      ].join(",")}`
    );
    console.log("RESULT PASS");
  } catch (error) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    if (stderr) {
      throw new Error(`${errorMessage(error)}\n\nMCP server stderr:\n${stderr}`);
    }
    throw error;
  } finally {
    await client.close();
    while (startedServers.length > 0) {
      const { label, server } = startedServers.pop()!;
      await closeServer(server, label);
    }
  }
}

function createSmokeInput(config: ReturnType<typeof loadConfig>) {
  const amount =
    optionalEnv(process.env.X402_RESOURCE_AMOUNT) ??
    optionalEnv(process.env.X402_RESOURCE_AMOUNT_MOTES) ??
    "2500000000";
  assertUnsignedInteger("X402_RESOURCE_AMOUNT", amount);

  const payTo =
    optionalEnv(process.env.X402_PAY_TO) ??
    optionalEnv(process.env.X402_PAYEE_PUBLIC_KEY) ??
    optionalEnv(process.env.X402_PAYEE_ACCOUNT_HASH);
  assert(payTo, "X402_PAY_TO or X402_PAYEE_PUBLIC_KEY is required");

  const asset =
    optionalEnv(process.env.X402_ASSET_ID) ??
    config.x402.assetPackage ??
    "casper-native-cspr";
  const timestamp = Date.now();

  return {
    agentId: optionalEnv(process.env.X402_SMOKE_AGENT_ID) ?? "agent-mainspring-x402-smoke",
    policyId:
      optionalEnv(process.env.X402_SMOKE_POLICY_ID) ?? `pol-casper-x402-smoke-${timestamp}`,
    idempotencyKey:
      optionalEnv(process.env.X402_SMOKE_IDEMPOTENCY_KEY) ??
      `casper-x402-smoke-${timestamp}`,
    amount,
    maxAmountPerPeriod:
      optionalEnv(process.env.X402_SMOKE_MAX_AMOUNT_PER_PERIOD) ??
      multiplyUnsignedInteger(amount, 10n),
    periodSeconds: parsePositiveInteger(process.env.X402_SMOKE_PERIOD_SECONDS, 86_400),
    asset,
    payTo
  };
}

async function startFacilitator(
  config: ReturnType<typeof loadConfig>
): Promise<SmokeServer | null> {
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

async function startSigner(config: ReturnType<typeof loadConfig>): Promise<SmokeServer | null> {
  assert(config.x402.signerUrl, "X402_SIGNER_URL is required for the signer sidecar");
  const buyerPrivateKeyPath =
    optionalEnv(process.env.X402_BUYER_PRIVATE_KEY_PATH) ??
    optionalEnv(process.env.CASPER_ACCOUNT_KEY_PATH) ??
    config.casper.accountKeyPath;
  assert(buyerPrivateKeyPath, "X402_BUYER_PRIVATE_KEY_PATH or CASPER_ACCOUNT_KEY_PATH is required");
  const buyerAccountHash = requiredEnv("X402_BUYER_ACCOUNT_HASH", process.env.X402_BUYER_ACCOUNT_HASH);
  const signingKey = loadCasperSigningKeyFromFile(resolveLocalPath(buyerPrivateKeyPath));
  const server = createX402SignerHttpServer({
    signingKey,
    buyerAccountHash,
    authToken: config.x402.signerAuthToken,
    maxValiditySeconds: parsePositiveInteger(process.env.X402_SIGNER_MAX_VALIDITY_SECONDS, 900),
    logger: console
  });
  return (await listenAtUrl(server, config.x402.signerUrl, "x402 signer"))
    ? { label: "x402 signer", server }
    : null;
}

async function startResource(config: ReturnType<typeof loadConfig>): Promise<SmokeServer | null> {
  const smoke = createSmokeInput(config);
  const resourceUrl = new URL(config.x402.resourceDemoUrl);
  const paymentRequirements = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: config.casper.caip2ChainId,
        maxAmountRequired: smoke.amount,
        amount: smoke.amount,
        resource: config.x402.resourceDemoUrl,
        method: "GET",
        asset: smoke.asset,
        payTo: smoke.payTo,
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
  const port = Number(parsed.port);
  assert(Number.isInteger(port) && port > 0, `${label} URL must include an explicit port: ${url}`);
  const host = parsed.hostname;

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        console.log(`${label}: ${url}`);
        resolve();
      });
    });
    return true;
  } catch (error) {
    if (isAddressInUse(error) && parseBoolean(process.env.X402_SMOKE_USE_RUNNING_SIDECARS, true)) {
      console.log(`${label}: using already-running service at ${url}`);
      return false;
    }

    throw error;
  }
}

function isAddressInUse(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "EADDRINUSE"
  );
}

async function closeServer(server: Server, label: string): Promise<void> {
  if (!server.listening) {
    return;
  }

  server.close();
  await once(server, "close");
  console.log(`${label}: stopped`);
}

async function callJsonTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  return parseJsonToolResult<T>(
    await client.callTool({ name, arguments: args }, undefined, requestOptions)
  );
}

function parseJsonToolResult<T>(result: ToolCallResult): T {
  if (!("content" in result)) {
    throw new Error(`Expected content result, received ${JSON.stringify(result)}`);
  }

  const [content] = result.content;
  if (!content || content.type !== "text") {
    throw new Error(`Expected text result, received ${JSON.stringify(result)}`);
  }

  return JSON.parse(content.text) as T;
}

function assertRealSettlementConfig(config: ReturnType<typeof loadConfig>): void {
  assert(config.x402.settlementEnabled, "X402_ENABLE_REAL_SETTLEMENT must be true");
  assert(
    config.x402.settlementMode === "resource-retry",
    `X402_SETTLEMENT_MODE must be resource-retry for the full paid-resource smoke, got ${config.x402.settlementMode}`
  );
  assert(config.x402.signerUrl, "X402_SIGNER_URL is required");
  assert(config.casper.submissionEnabled, "CASPER_ENABLE_REAL_SUBMISSION must be true");
  assert(config.casper.rpcUrl, "CASPER_RPC_URL is required");
  assert(config.casper.accountKeyPath, "CASPER_ACCOUNT_KEY_PATH is required");
}

function assertNoSignedPayloadBody(value: unknown): void {
  const forbiddenKeys = new Set([
    "signed_payload",
    "signedPayload",
    "payment_payload",
    "paymentPayload",
    "PAYMENT-SIGNATURE"
  ]);

  const visit = (nested: unknown, path: string): void => {
    if (Array.isArray(nested)) {
      nested.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!nested || typeof nested !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(nested as Record<string, unknown>)) {
      assert(!forbiddenKeys.has(key), `Receipt contains signed payload body at ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };

  visit(value, "receipt");
}

function addDecimalAmounts(left: string, right: string): string {
  const leftParts = parseDecimalAmount(left);
  const rightParts = parseDecimalAmount(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);
  return formatDecimal(leftValue + rightValue, scale);
}

function compareDecimalAmounts(left: string, right: string): number {
  const leftParts = parseDecimalAmount(left);
  const rightParts = parseDecimalAmount(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function parseDecimalAmount(value: string): { value: bigint; scale: number } {
  assert(/^\d+(\.\d+)?$/.test(value), `Invalid decimal amount: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  return {
    value: BigInt(`${whole}${fraction}`),
    scale: fraction.length
  };
}

function formatDecimal(value: bigint, scale: number): string {
  if (scale === 0) {
    return value.toString();
  }

  const raw = value.toString().padStart(scale + 1, "0");
  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function multiplyUnsignedInteger(value: string, multiplier: bigint): string {
  assertUnsignedInteger("amount", value);
  return (BigInt(value) * multiplier).toString();
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  assert(Number.isInteger(parsed) && parsed > 0, `Expected positive integer, got ${normalized}`);
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = optionalEnv(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
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

function assertUnsignedInteger(name: string, value: string): void {
  assert(/^(0|[1-9]\d*)$/.test(value), `${name} must be an unsigned integer`);
}

function assertHex64(name: string, value: string): void {
  assert(/^[a-f0-9]{64}$/i.test(value), `${name} must be a 64-character hex string`);
}

function assertCasperTransactionHash(value: string | null | undefined): asserts value is string {
  assert(
    typeof value === "string" && /^(hash-)?[a-f0-9]{64}$/i.test(value),
    `Expected Casper transaction hash, got ${value ?? "<missing>"}`
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
