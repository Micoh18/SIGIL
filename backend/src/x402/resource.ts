import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { canonicalizeJson, toJsonObject } from "../memory/canonical.js";
import { sha256Hex } from "../memory/hash.js";
import type { JsonObject, JsonValue } from "../memory/types.js";
import { verifyX402SettlementResponse } from "./readiness.js";

const DEFAULT_PAYMENT_HEADER_NAME = "PAYMENT-SIGNATURE";
const MAX_SIGNATURE_HEADER_BYTES = 64 * 1024;

export type X402PaidResourceLogger = {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
};

export type X402PaidResourceBodyFactory = (input: {
  paymentPayload: JsonObject;
  settlementResponse: JsonObject;
}) => JsonObject | Promise<JsonObject>;

export type X402PaidResourceFacilitatorPostResult = {
  status: number;
  body: unknown;
};

export type X402PaidResourceFacilitatorPoster = (
  url: string,
  body: JsonObject
) => Promise<X402PaidResourceFacilitatorPostResult>;

export type X402PaidResourceHttpServerConfig = {
  resourcePath: string;
  facilitatorUrl: string;
  paymentRequirements: JsonObject;
  paymentHeaderName?: string;
  resourceBody?: JsonObject | X402PaidResourceBodyFactory;
  postJson?: X402PaidResourceFacilitatorPoster;
  logger?: X402PaidResourceLogger;
};

export function createX402PaidResourceHttpServer(
  config: X402PaidResourceHttpServerConfig
): Server {
  const paymentHeaderName = config.paymentHeaderName ?? DEFAULT_PAYMENT_HEADER_NAME;
  const postJson = config.postJson ?? postJsonWithFetch;

  return createServer(async (request, response) => {
    try {
      await handleX402PaidResourceRequest(request, response, {
        ...config,
        paymentHeaderName,
        postJson
      });
    } catch (error) {
      config.logger?.error?.(`x402 paid resource failed: ${errorMessage(error)}`);
      sendJson(response, 500, { error: "resource_failed" });
    }
  });
}

async function handleX402PaidResourceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: Required<Pick<X402PaidResourceHttpServerConfig, "paymentHeaderName" | "postJson">> &
    X402PaidResourceHttpServerConfig
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method !== "GET" || pathname !== config.resourcePath) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  const paymentHeader = headerValue(request, config.paymentHeaderName);
  if (!paymentHeader) {
    sendPaymentRequired(response, config.paymentRequirements);
    return;
  }

  if (Buffer.byteLength(paymentHeader, "utf8") > MAX_SIGNATURE_HEADER_BYTES) {
    sendPaymentRequired(response, config.paymentRequirements, {
      error: "payment_signature_too_large"
    });
    return;
  }

  const paymentPayload = parsePaymentHeader(paymentHeader);
  if (!paymentPayload) {
    sendPaymentRequired(response, config.paymentRequirements, {
      error: "invalid_payment_signature"
    });
    return;
  }

  const selectedRequirement = selectedRequirementForPayload(
    config.paymentRequirements,
    paymentPayload
  );
  if (!selectedRequirement) {
    config.logger?.error?.("x402 paid resource could not match selected requirement");
    sendJson(response, 500, { error: "payment_requirement_mismatch" });
    return;
  }

  const facilitatorRequest = {
    paymentPayload,
    paymentRequirements: config.paymentRequirements
  };
  const verify = await postFacilitator(config, "verify", facilitatorRequest);
  if (!verify.ok || !facilitatorVerifyAccepted(verify.body)) {
    config.logger?.warn?.(
      `x402 paid resource rejected verify status=${verify.status} reason=${facilitatorReason(
        verify.body
      )}`
    );
    sendPaymentRequired(response, config.paymentRequirements, {
      error: "payment_verify_failed",
      reason: facilitatorReason(verify.body),
      facilitator_status: verify.status
    });
    return;
  }

  const settle = await postFacilitator(config, "settle", facilitatorRequest);
  if (!settle.ok) {
    sendJson(response, 502, {
      error: "payment_settle_failed",
      reason: facilitatorReason(settle.body),
      facilitator_status: settle.status
    });
    return;
  }

  const settlementBody = toJsonObject(settle.body, "settlement_response");
  const settlement = verifyX402SettlementResponse(settlementBody, {
    selectedRequirement,
    signedPayload: paymentPayload
  });
  if (!settlement.settled) {
    config.logger?.warn?.(
      `x402 paid resource settlement not verified reason=${settlement.reason}`
    );
    sendJson(response, 502, {
      error: "payment_settlement_not_verified",
      reason: settlement.reason,
      facilitator_status: settle.status
    });
    return;
  }

  response.setHeader("PAYMENT-RESPONSE", encodeBase64Json(settlementBody));
  response.setHeader("X-PAYMENT-RESPONSE", encodeBase64Json(settlementBody));
  sendJson(response, 200, await resourceBody(config, paymentPayload, settlementBody));
}

async function postFacilitator(
  config: Required<Pick<X402PaidResourceHttpServerConfig, "postJson">> &
    X402PaidResourceHttpServerConfig,
  path: "verify" | "settle",
  body: JsonObject
): Promise<X402PaidResourceFacilitatorPostResult & { ok: boolean }> {
  try {
    const result = await config.postJson(facilitatorEndpoint(config.facilitatorUrl, path), body);
    return {
      ...result,
      ok: result.status >= 200 && result.status < 300
    };
  } catch {
    return {
      status: 502,
      ok: false,
      body: { error: `facilitator_${path}_request_failed` }
    };
  }
}

function facilitatorVerifyAccepted(value: unknown): boolean {
  const body = asRecord(value);
  return Boolean(body && (body.valid === true || body.success === true));
}

async function resourceBody(
  config: X402PaidResourceHttpServerConfig,
  paymentPayload: JsonObject,
  settlementResponse: JsonObject
): Promise<JsonObject> {
  if (typeof config.resourceBody === "function") {
    return config.resourceBody({ paymentPayload, settlementResponse });
  }

  return (
    config.resourceBody ?? {
      weather: "sunny",
      unit: "celsius",
      temperature: 22,
      source: "casper-x402-resource",
      settlement: "settled"
    }
  );
}

function selectedRequirementForPayload(
  paymentRequirements: JsonObject,
  paymentPayload: JsonObject
): JsonObject | null {
  const selectedRequirementHash = firstString(paymentPayload, [
    "selectedRequirementHash",
    "selected_requirement_hash"
  ]);
  if (!selectedRequirementHash) {
    return null;
  }

  const accepts = paymentRequirements.accepts;
  if (Array.isArray(accepts)) {
    for (const candidate of accepts) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        continue;
      }

      const requirement = toJsonObject(candidate, "paymentRequirements.accepts[]");
      if (sha256Hex(canonicalizeJson(requirement)) === selectedRequirementHash.toLowerCase()) {
        return requirement;
      }
    }

    return null;
  }

  if (sha256Hex(canonicalizeJson(paymentRequirements)) === selectedRequirementHash.toLowerCase()) {
    return paymentRequirements;
  }

  return null;
}

function sendPaymentRequired(
  response: ServerResponse,
  paymentRequirements: JsonObject,
  body: JsonObject | null = null
): void {
  const encodedRequirements = encodeBase64Json(paymentRequirements);
  response.setHeader("PAYMENT-REQUIRED", encodedRequirements);
  response.setHeader("X-PAYMENT-REQUIRED", encodedRequirements);
  sendJson(response, 402, body ?? paymentRequirements);
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.writableEnded) {
    return;
  }

  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(`${JSON.stringify(value)}\n`);
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function parsePaymentHeader(value: string): JsonObject | null {
  for (const candidate of [decodeBase64(value), value]) {
    if (!candidate) {
      continue;
    }

    try {
      return toJsonObject(JSON.parse(candidate) as unknown, "payment_signature");
    } catch {
      continue;
    }
  }

  return null;
}

async function postJsonWithFetch(
  url: string,
  body: JsonObject
): Promise<X402PaidResourceFacilitatorPostResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? parseJsonOrRaw(text) : {}
  };
}

function parseJsonOrRaw(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return { raw: text };
  }
}

function facilitatorEndpoint(facilitatorUrl: string, path: "verify" | "settle"): string {
  return new URL(path, facilitatorUrl.endsWith("/") ? facilitatorUrl : `${facilitatorUrl}/`).toString();
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeBase64(value: string): string | null {
  try {
    return Buffer.from(value.trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function facilitatorReason(value: unknown): string | null {
  const body = asRecord(value);
  if (!body) {
    return null;
  }

  return firstString(body, ["reason", "error", "message"]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
