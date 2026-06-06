import { once } from "node:events";
import type { Server } from "node:http";
import { loadLocalEnvFile } from "../src/env-file.js";
import { canonicalizeJson } from "../src/memory/canonical.js";
import { sha256Hex } from "../src/memory/hash.js";
import type { JsonObject } from "../src/memory/types.js";
import { createX402PaidResourceHttpServer } from "../src/x402/resource.js";

loadLocalEnvFile();

const config = loadResourceConfig();
const resourceEndpoint = new URL(config.x402.resourceDemoUrl);
const host =
  optionalEnv(process.env.X402_RESOURCE_HOST) ??
  optionalEnv(process.env.X402_LOCAL_RESOURCE_HOST) ??
  "127.0.0.1";
const port = parsePort(
  process.env.X402_RESOURCE_PORT ??
    process.env.X402_LOCAL_RESOURCE_PORT ??
    resourceEndpoint.port,
  4021
);
const resourcePath = resourceEndpoint.pathname || "/weather";
const smoke = process.argv.includes("--smoke");
const paymentRequirements = createPaymentRequirements();

const resourceServer = createX402PaidResourceHttpServer({
  resourcePath,
  facilitatorUrl: config.x402.facilitatorUrl,
  paymentRequirements,
  paymentHeaderName: config.x402.paymentHeaderName,
  logger: console
});

await listen(resourceServer, host, port);

console.log(`x402 paid resource: ${config.x402.resourceDemoUrl}`);
console.log(`x402 facilitator:   ${config.x402.facilitatorUrl}`);
console.log(`x402 payment header: ${config.x402.paymentHeaderName}`);
console.log("x402 mode: real-facilitator");

if (smoke) {
  try {
    await runSmoke();
  } finally {
    await close(resourceServer);
  }
} else {
  console.log("Start the signer with `npm run x402:signer --prefix backend`.");
  console.log("Press Ctrl+C to stop.");
}

function createPaymentRequirements(): JsonObject {
  const amount =
    optionalEnv(process.env.X402_RESOURCE_AMOUNT) ??
    optionalEnv(process.env.X402_RESOURCE_AMOUNT_MOTES) ??
    "2500000000";
  assertUnsignedInteger("X402_RESOURCE_AMOUNT", amount);

  const timeoutSeconds = parsePositiveInteger(
    process.env.X402_RESOURCE_TIMEOUT_SECONDS ??
      process.env.X402_SIGNER_MAX_VALIDITY_SECONDS,
    "X402_RESOURCE_TIMEOUT_SECONDS",
    60
  );

  const asset =
    optionalEnv(process.env.X402_ASSET_ID) ??
    config.x402.assetPackage ??
    "casper-native-cspr";
  const payTo =
    optionalEnv(process.env.X402_PAY_TO) ??
    optionalEnv(process.env.X402_PAYEE_PUBLIC_KEY) ??
    optionalEnv(process.env.X402_PAYEE_ACCOUNT_HASH) ??
    `02${"2".repeat(66)}`;

  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: config.casper.caip2ChainId,
        maxAmountRequired: amount,
        amount,
        resource: config.x402.resourceDemoUrl,
        method: "GET",
        asset,
        payTo,
        maxTimeoutSeconds: timeoutSeconds,
        description: "Casper x402 paid weather resource"
      }
    ],
    facilitator: config.x402.facilitatorUrl
  };
}

function loadResourceConfig(): {
  casper: {
    caip2ChainId: string;
  };
  x402: {
    facilitatorUrl: string;
    resourceDemoUrl: string;
    paymentHeaderName: string;
    signerUrl: string | null;
    signerAuthToken: string | null;
    assetPackage: string | null;
  };
} {
  const facilitatorUrl =
    optionalEnv(process.env.X402_FACILITATOR_URL) ?? "http://localhost:4022";
  const resourceDemoUrl =
    optionalEnv(process.env.X402_RESOURCE_DEMO_URL) ?? "http://localhost:4021/weather";
  const signerUrl = optionalEnv(process.env.X402_SIGNER_URL);

  assertHttpUrl("X402_FACILITATOR_URL", facilitatorUrl);
  assertHttpUrl("X402_RESOURCE_DEMO_URL", resourceDemoUrl);
  if (signerUrl) {
    assertHttpUrl("X402_SIGNER_URL", signerUrl);
  }

  return {
    casper: {
      caip2ChainId: optionalEnv(process.env.CASPER_CAIP2_CHAIN_ID) ?? "casper:casper-test"
    },
    x402: {
      facilitatorUrl,
      resourceDemoUrl,
      paymentHeaderName:
        optionalEnv(process.env.X402_PAYMENT_HEADER_NAME) ?? "PAYMENT-SIGNATURE",
      signerUrl,
      signerAuthToken: optionalEnv(process.env.X402_SIGNER_AUTH_TOKEN),
      assetPackage: optionalEnv(process.env.X402_ASSET_PACKAGE)
    }
  };
}

async function runSmoke(): Promise<void> {
  const challenge = await fetch(config.x402.resourceDemoUrl);
  if (challenge.status !== 402) {
    throw new Error(`Expected 402 challenge, got ${challenge.status}`);
  }
  if (!challenge.headers.get("PAYMENT-REQUIRED")) {
    throw new Error("Expected PAYMENT-REQUIRED header");
  }

  if (!config.x402.signerUrl) {
    console.log("PASS x402 paid resource smoke: challenge=402 payment_required=true");
    console.log("Set X402_SIGNER_URL to run the full paid retry smoke.");
    return;
  }

  const selectedRequirement = paymentRequirements.accepts?.[0];
  if (!selectedRequirement || typeof selectedRequirement !== "object") {
    throw new Error("Payment requirements are missing an accepted requirement");
  }

  const sign = await fetch(config.x402.signerUrl, {
    method: "POST",
    headers: signerHeaders(),
    body: JSON.stringify({
      payment_id: "pay_resource_smoke",
      facilitator_url: config.x402.facilitatorUrl,
      method: "GET",
      url: config.x402.resourceDemoUrl,
      selected_requirement: selectedRequirement,
      selected_requirement_hash: sha256Hex(canonicalizeJson(selectedRequirement)),
      policy_hash: optionalEnv(process.env.X402_SMOKE_POLICY_HASH) ?? "b".repeat(64)
    })
  });
  const signBody = (await sign.json()) as { signed_payload?: unknown };
  if (!sign.ok || !signBody.signed_payload) {
    throw new Error(`Signer smoke failed with ${sign.status}`);
  }

  const paid = await fetch(config.x402.resourceDemoUrl, {
    headers: {
      [config.x402.paymentHeaderName]: encodeBase64Json(signBody.signed_payload)
    }
  });
  const paymentResponse = paid.headers.get("PAYMENT-RESPONSE");
  if (paid.status !== 200 || !paymentResponse) {
    throw new Error(`Paid resource smoke failed with ${paid.status}`);
  }

  const decodedPaymentResponse = parseBase64Json(paymentResponse);
  if (!decodedPaymentResponse.ok || !hasTransactionHash(decodedPaymentResponse.value)) {
    throw new Error("PAYMENT-RESPONSE did not include a Casper transaction hash");
  }

  console.log(
    "PASS x402 paid resource smoke: challenge=402 signed_payload=true paid=200 payment_response=true"
  );
}

function signerHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (config.x402.signerAuthToken) {
    headers.authorization = `Bearer ${config.x402.signerAuthToken}`;
  }

  return headers;
}

function hasTransactionHash(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return ["transactionHash", "transaction_hash", "txHash", "tx_hash", "transaction"].some(
    (key) => typeof record[key] === "string" && record[key].trim().length > 0
  );
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function parseBase64Json(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(Buffer.from(value, "base64").toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

function optionalEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertUnsignedInteger(name: string, value: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer`);
  }
}

function assertHttpUrl(name: string, value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be an HTTP(S) URL`);
  }
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number
): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} must be a positive integer`);
  }

  return Number(normalized);
}

function parsePort(value: string | undefined, fallback: number): number {
  const normalized = optionalEnv(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid resource port: ${normalized}`);
  }

  return parsed;
}

async function listen(server: Server, listenHost: string, listenPort: number): Promise<void> {
  server.listen(listenPort, listenHost);
  await once(server, "listening");
}

async function close(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  server.close();
  await once(server, "close");
}
