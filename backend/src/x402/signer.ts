import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  type KeyObject
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { canonicalizeJson, toJsonObject } from "../memory/canonical.js";
import { sha256Hex } from "../memory/hash.js";
import type { JsonObject } from "../memory/types.js";

const HASH_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const HTTP_METHOD_PATTERN = /^[A-Za-z]+$/;
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_VALIDITY_SECONDS = 900;
const CASPER_ACCOUNT_PATTERN = /^(account-hash-[a-f0-9]{64}|0[01][a-f0-9]{64})$/i;
const SENSITIVE_REQUIREMENT_KEY_PATTERN =
  /private|secret|token|password|credential|authorization|seed|mnemonic/i;

const SECP256K1_P = BigInt(
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"
);
const SECP256K1_N = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"
);
const SECP256K1_GX = BigInt(
  "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
);
const SECP256K1_GY = BigInt(
  "0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"
);

export type CasperSigningKey =
  | {
      algorithm: "ed25519";
      privateKey: KeyObject;
      publicKey: string;
    }
  | {
      algorithm: "secp256k1";
      privateKey: KeyObject;
      privateScalar: bigint;
      publicKey: string;
    };

export type X402SignerLogger = {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
};

export type X402SignerConfig = {
  signingKey: CasperSigningKey;
  buyerAccountHash: string;
  now?: () => Date;
  maxValiditySeconds?: number;
  signBytes?: (bytes: Buffer, signingKey: CasperSigningKey) => string;
};

export type X402SignerHttpServerConfig = X402SignerConfig & {
  authToken?: string | null;
  logger?: X402SignerLogger;
  maxBodyBytes?: number;
};

export type X402SignerRequest = {
  payment_id: string;
  facilitator_url: string | null;
  method: string;
  url: string;
  selected_requirement: JsonObject;
  selected_requirement_hash: string;
  policy_hash: string;
};

export type X402SignerRejectionReason =
  | "request_not_object"
  | "unexpected_field"
  | "payment_id_invalid"
  | "facilitator_url_invalid"
  | "method_invalid"
  | "url_invalid"
  | "selected_requirement_missing"
  | "selected_requirement_sensitive_field"
  | "selected_requirement_hash_invalid"
  | "selected_requirement_hash_mismatch"
  | "policy_hash_invalid"
  | "scheme_missing"
  | "scheme_unsupported"
  | "network_missing"
  | "amount_missing"
  | "amount_invalid"
  | "resource_missing"
  | "resource_mismatch"
  | "method_missing"
  | "method_mismatch"
  | "asset_missing"
  | "payee_missing"
  | "timeout_missing"
  | "timeout_invalid"
  | "buyer_account_invalid";

export type X402SignerValidation =
  | {
      ok: true;
      request: X402SignerRequest;
      requirement: NormalizedRequirement;
    }
  | {
      ok: false;
      reason: X402SignerRejectionReason;
    };

export type X402SignerResult =
  | {
      signed: true;
      signed_payload: JsonObject;
    }
  | {
      signed: false;
      reason: X402SignerRejectionReason;
    };

type NormalizedRequirement = {
  scheme: "exact";
  network: string;
  amount: string;
  resource: string;
  method: string;
  asset: string;
  payTo: string;
  timeoutSeconds: number;
};

type AuthorizationBase = {
  domain: "casper-x402-authorization";
  version: 1;
  paymentId: string;
  policyHash: string;
  selectedRequirementHash: string;
  method: string;
  resource: string;
  scheme: "exact";
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  payer: string;
  publicKey: string;
  validAfter: string;
  validBefore: string;
};

type Secp256k1Point = {
  x: bigint;
  y: bigint;
};

export function loadCasperSigningKeyFromFile(path: string): CasperSigningKey {
  return loadCasperSigningKey(readFileSync(path, "utf8"));
}

export function loadCasperSigningKey(pem: string): CasperSigningKey {
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey);

  if (privateKey.asymmetricKeyType === "ed25519") {
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    if (typeof jwk.x !== "string") {
      throw new Error("Unable to read Ed25519 public key");
    }

    return {
      algorithm: "ed25519",
      privateKey,
      publicKey: `01${base64UrlToBuffer(jwk.x).toString("hex")}`
    };
  }

  if (privateKey.asymmetricKeyType === "ec") {
    const jwk = privateKey.export({ format: "jwk" }) as JsonWebKey;
    if (jwk.crv !== "secp256k1" || typeof jwk.d !== "string") {
      throw new Error("Only Ed25519 and secp256k1 Casper keys are supported");
    }
    if (typeof jwk.x !== "string" || typeof jwk.y !== "string") {
      throw new Error("Unable to read secp256k1 public key");
    }

    const x = leftPad(base64UrlToBuffer(jwk.x), 32);
    const y = leftPad(base64UrlToBuffer(jwk.y), 32);
    const compressedPrefix = y[y.length - 1]! % 2 === 0 ? "02" : "03";

    return {
      algorithm: "secp256k1",
      privateKey,
      privateScalar: bytesToBigInt(leftPad(base64UrlToBuffer(jwk.d), 32)),
      publicKey: `02${compressedPrefix}${x.toString("hex")}`
    };
  }

  throw new Error("Only Ed25519 and secp256k1 Casper keys are supported");
}

export function validateX402SignerRequest(input: unknown): X402SignerValidation {
  const body = asRecord(input);
  if (!body) {
    return rejected("request_not_object");
  }

  const allowedFields = new Set([
    "payment_id",
    "facilitator_url",
    "method",
    "url",
    "selected_requirement",
    "approved_requirement",
    "selected_requirement_hash",
    "policy_hash"
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      return rejected("unexpected_field");
    }
  }

  const paymentId = stringValue(body.payment_id);
  if (!paymentId || !PAYMENT_ID_PATTERN.test(paymentId)) {
    return rejected("payment_id_invalid");
  }

  const method = stringValue(body.method)?.toUpperCase() ?? null;
  if (!method || !HTTP_METHOD_PATTERN.test(method)) {
    return rejected("method_invalid");
  }

  const url = stringValue(body.url);
  if (!url || !isHttpUrl(url)) {
    return rejected("url_invalid");
  }

  const facilitatorUrl = nullableStringValue(body.facilitator_url);
  if (facilitatorUrl !== null && !isHttpUrl(facilitatorUrl)) {
    return rejected("facilitator_url_invalid");
  }

  const selectedRequirementValue = body.selected_requirement ?? body.approved_requirement;
  let selectedRequirement: JsonObject;
  try {
    selectedRequirement = toJsonObject(selectedRequirementValue, "selected_requirement");
  } catch {
    return rejected("selected_requirement_missing");
  }

  if (hasSensitiveRequirementKey(selectedRequirement)) {
    return rejected("selected_requirement_sensitive_field");
  }

  const selectedRequirementHash = stringValue(body.selected_requirement_hash);
  if (!selectedRequirementHash || !HASH_HEX_PATTERN.test(selectedRequirementHash)) {
    return rejected("selected_requirement_hash_invalid");
  }

  const actualRequirementHash = sha256Hex(canonicalizeJson(selectedRequirement));
  if (selectedRequirementHash.toLowerCase() !== actualRequirementHash) {
    return rejected("selected_requirement_hash_mismatch");
  }

  const policyHash = stringValue(body.policy_hash);
  if (!policyHash || !HASH_HEX_PATTERN.test(policyHash)) {
    return rejected("policy_hash_invalid");
  }

  const requirement = normalizeRequirement(selectedRequirement);
  if (!requirement.ok) {
    return rejected(requirement.reason);
  }

  if (requirement.value.resource !== url) {
    return rejected("resource_mismatch");
  }

  if (requirement.value.method !== method) {
    return rejected("method_mismatch");
  }

  return {
    ok: true,
    request: {
      payment_id: paymentId,
      facilitator_url: facilitatorUrl,
      method,
      url,
      selected_requirement: selectedRequirement,
      selected_requirement_hash: selectedRequirementHash.toLowerCase(),
      policy_hash: policyHash.toLowerCase()
    },
    requirement: requirement.value
  };
}

export function signX402PaymentPayload(
  input: unknown,
  config: X402SignerConfig
): X402SignerResult {
  const validation = validateX402SignerRequest(input);
  if (!validation.ok) {
    return {
      signed: false,
      reason: validation.reason
    };
  }

  const buyerAccountHash = normalizeBuyerAccount(config.buyerAccountHash);
  if (!buyerAccountHash) {
    return {
      signed: false,
      reason: "buyer_account_invalid"
    };
  }

  const validity = createValidityWindow(
    config.now?.() ?? new Date(),
    validation.requirement.timeoutSeconds,
    config.maxValiditySeconds ?? DEFAULT_MAX_VALIDITY_SECONDS
  );
  const authorizationBase: AuthorizationBase = {
    domain: "casper-x402-authorization",
    version: 1,
    paymentId: validation.request.payment_id,
    policyHash: validation.request.policy_hash,
    selectedRequirementHash: validation.request.selected_requirement_hash,
    method: validation.request.method,
    resource: validation.request.url,
    scheme: validation.requirement.scheme,
    network: validation.requirement.network,
    asset: validation.requirement.asset,
    payTo: validation.requirement.payTo,
    amount: validation.requirement.amount,
    payer: buyerAccountHash,
    publicKey: config.signingKey.publicKey,
    validAfter: validity.validAfter,
    validBefore: validity.validBefore
  };
  const nonce = sha256Hex(canonicalizeJson(authorizationBase));
  const authorizationToSign = {
    ...authorizationBase,
    nonce
  };
  const canonicalAuthorization = canonicalizeJson(authorizationToSign);
  const canonicalBytes = Buffer.from(canonicalAuthorization, "utf8");
  const signature = (config.signBytes ?? signCasperBytes)(canonicalBytes, config.signingKey);
  const authorizationHash = sha256Hex(canonicalAuthorization);

  return {
    signed: true,
    signed_payload: {
      x402Version: 2,
      scheme: validation.requirement.scheme,
      network: validation.requirement.network,
      accepted: validation.request.selected_requirement,
      paymentId: validation.request.payment_id,
      policyHash: validation.request.policy_hash,
      method: validation.request.method,
      resource: validation.request.url,
      asset: validation.requirement.asset,
      payTo: validation.requirement.payTo,
      amount: validation.requirement.amount,
      payer: buyerAccountHash,
      nonce,
      validAfter: validity.validAfter,
      validUntil: validity.validBefore,
      selectedRequirementHash: validation.request.selected_requirement_hash,
      authorization: {
        type:
          validation.requirement.asset.toLowerCase() === "casper-native-cspr"
            ? "casper-native-transfer"
            : "casper-cep18-transfer-with-authorization",
        paymentId: validation.request.payment_id,
        policyHash: validation.request.policy_hash,
        method: validation.request.method,
        resource: validation.request.url,
        scheme: validation.requirement.scheme,
        network: validation.requirement.network,
        asset: validation.requirement.asset,
        payTo: validation.requirement.payTo,
        payer: buyerAccountHash,
        from: buyerAccountHash,
        to: validation.requirement.payTo,
        amount: validation.requirement.amount,
        value: validation.requirement.amount,
        validAfter: validity.validAfter,
        validBefore: validity.validBefore,
        nonce,
        publicKey: config.signingKey.publicKey,
        signature,
        authorizationHash
      }
    }
  };
}

export function createX402SignerHttpServer(config: X402SignerHttpServerConfig): Server {
  return createServer(async (request, response) => {
    try {
      await handleX402SignerHttpRequest(request, response, config);
    } catch {
      config.logger?.error?.("x402 signer request failed");
      sendJson(response, 500, { error: "signer_failed" });
    }
  });
}

async function handleX402SignerHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: X402SignerHttpServerConfig
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/sign") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (config.authToken) {
    const authorization = headerValue(request, "authorization");
    if (authorization !== `Bearer ${config.authToken}`) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
  }

  const body = await readJsonBody(request, config.maxBodyBytes ?? MAX_BODY_BYTES);
  if (!body.ok) {
    config.logger?.warn?.(`x402 signer rejected reason=${body.reason}`);
    sendJson(response, 400, { error: "invalid_json", reason: body.reason });
    return;
  }

  const result = signX402PaymentPayload(body.value, config);
  if (!result.signed) {
    config.logger?.warn?.(`x402 signer rejected reason=${result.reason}`);
    sendJson(response, 400, { error: "sign_request_invalid", reason: result.reason });
    return;
  }

  const signedPayloadHash = sha256Hex(canonicalizeJson(result.signed_payload));
  const paymentId = stringValue(asRecord(body.value)?.payment_id) ?? "<unknown>";
  const selectedRequirementHash =
    stringValue(asRecord(body.value)?.selected_requirement_hash) ?? "<unknown>";
  config.logger?.info?.(
    `x402 signer signed payment_id=${paymentId} selected_requirement_hash=${selectedRequirementHash} signed_payload_hash=${signedPayloadHash}`
  );
  sendJson(response, 200, { signed_payload: result.signed_payload });
}

function normalizeRequirement(
  requirement: JsonObject
):
  | {
      ok: true;
      value: NormalizedRequirement;
    }
  | {
      ok: false;
      reason: X402SignerRejectionReason;
    } {
  const scheme = firstString(requirement, ["scheme"]);
  if (!scheme) {
    return { ok: false, reason: "scheme_missing" };
  }
  if (scheme !== "exact") {
    return { ok: false, reason: "scheme_unsupported" };
  }

  const network = firstString(requirement, [
    "network",
    "networkId",
    "network_id",
    "caip2_chain_id",
    "caip2ChainId"
  ]);
  if (!network) {
    return { ok: false, reason: "network_missing" };
  }

  const amount = firstString(requirement, [
    "maxAmountRequired",
    "amount",
    "max_amount_required"
  ]);
  if (!amount) {
    return { ok: false, reason: "amount_missing" };
  }
  if (!/^(0|[1-9]\d*)$/.test(amount)) {
    return { ok: false, reason: "amount_invalid" };
  }

  const resource = firstString(requirement, ["resource", "resourceUrl", "resource_url"]);
  if (!resource) {
    return { ok: false, reason: "resource_missing" };
  }

  const method = firstString(requirement, ["method", "httpMethod", "http_method"]);
  if (!method) {
    return { ok: false, reason: "method_missing" };
  }
  const normalizedMethod = method.toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(normalizedMethod)) {
    return { ok: false, reason: "method_invalid" };
  }

  const asset = firstString(requirement, [
    "asset",
    "assetId",
    "asset_id",
    "assetPackage",
    "asset_package",
    "assetPackageHash",
    "asset_package_hash"
  ]);
  if (!asset) {
    return { ok: false, reason: "asset_missing" };
  }

  const payTo = firstString(requirement, [
    "payTo",
    "pay_to",
    "payee",
    "recipient",
    "recipientAddress",
    "recipient_address"
  ]);
  if (!payTo) {
    return { ok: false, reason: "payee_missing" };
  }

  const timeout = firstValue(requirement, [
    "timeout",
    "timeoutSeconds",
    "timeout_seconds",
    "maxTimeoutSeconds",
    "max_timeout_seconds"
  ]);
  if (timeout === null) {
    return { ok: false, reason: "timeout_missing" };
  }
  const timeoutSeconds = timeoutValue(timeout);
  if (timeoutSeconds === null) {
    return { ok: false, reason: "timeout_invalid" };
  }

  return {
    ok: true,
    value: {
      scheme: "exact",
      network,
      amount,
      resource,
      method: normalizedMethod,
      asset,
      payTo,
      timeoutSeconds
    }
  };
}

function signCasperBytes(bytes: Buffer, signingKey: CasperSigningKey): string {
  if (signingKey.algorithm === "ed25519") {
    return `01${nodeSign(null, bytes, signingKey.privateKey).toString("hex")}`;
  }

  const digest = createHash("sha256").update(bytes).digest();
  const signature = deterministicSecp256k1Signature(digest, signingKey.privateScalar);
  return `02${signature}`;
}

function deterministicSecp256k1Signature(digest: Buffer, privateScalar: bigint): string {
  const z = bytesToBigInt(digest) % SECP256K1_N;

  for (const k of deterministicK(digest, privateScalar)) {
    const point = scalarMultiply(k, {
      x: SECP256K1_GX,
      y: SECP256K1_GY
    });
    if (!point) {
      continue;
    }

    const r = mod(point.x, SECP256K1_N);
    if (r === 0n) {
      continue;
    }

    let s = mod(modInverse(k, SECP256K1_N) * (z + r * privateScalar), SECP256K1_N);
    if (s === 0n) {
      continue;
    }

    if (s > SECP256K1_N / 2n) {
      s = SECP256K1_N - s;
    }

    return `${bigIntToFixedHex(r, 32)}${bigIntToFixedHex(s, 32)}`;
  }

  throw new Error("Unable to produce deterministic secp256k1 signature");
}

function* deterministicK(
  digest: Buffer,
  privateScalar: bigint
): Generator<bigint, never, unknown> {
  const x = bigIntToBuffer(privateScalar, 32);
  const h1 = bigIntToBuffer(bytesToBigInt(digest) % SECP256K1_N, 32);
  let v: Buffer = Buffer.alloc(32, 0x01);
  let k: Buffer = Buffer.alloc(32, 0x00);

  k = hmacSha256(k, Buffer.concat([v, Buffer.from([0x00]), x, h1]));
  v = hmacSha256(k, v);
  k = hmacSha256(k, Buffer.concat([v, Buffer.from([0x01]), x, h1]));
  v = hmacSha256(k, v);

  for (;;) {
    v = hmacSha256(k, v);
    const candidate = bytesToBigInt(v);
    if (candidate > 0n && candidate < SECP256K1_N) {
      yield candidate;
    }

    k = hmacSha256(k, Buffer.concat([v, Buffer.from([0x00])]));
    v = hmacSha256(k, v);
  }
}

function scalarMultiply(
  scalar: bigint,
  point: Secp256k1Point | null
): Secp256k1Point | null {
  let addend = point;
  let result: Secp256k1Point | null = null;
  let remaining = scalar;

  while (remaining > 0n) {
    if (remaining & 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointAdd(addend, addend);
    remaining >>= 1n;
  }

  return result;
}

function pointAdd(
  left: Secp256k1Point | null,
  right: Secp256k1Point | null
): Secp256k1Point | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (left.x === right.x && mod(left.y + right.y, SECP256K1_P) === 0n) {
    return null;
  }

  const slope =
    left.x === right.x && left.y === right.y
      ? mod(3n * left.x * left.x * modInverse(2n * left.y, SECP256K1_P), SECP256K1_P)
      : mod((right.y - left.y) * modInverse(right.x - left.x, SECP256K1_P), SECP256K1_P);
  const x = mod(slope * slope - left.x - right.x, SECP256K1_P);
  const y = mod(slope * (left.x - x) - left.y, SECP256K1_P);

  return { x, y };
}

function createValidityWindow(
  now: Date,
  requirementTimeoutSeconds: number,
  maxValiditySeconds: number
): { validAfter: string; validBefore: string } {
  const validitySeconds = Math.max(
    1,
    Math.min(requirementTimeoutSeconds, maxValiditySeconds)
  );
  const validAfterMs = Math.floor(now.getTime() / 1000) * 1000;
  const validBeforeMs = validAfterMs + validitySeconds * 1000;

  return {
    validAfter: new Date(validAfterMs).toISOString(),
    validBefore: new Date(validBeforeMs).toISOString()
  };
}

function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      reason: "body_too_large" | "body_invalid_json";
    }
> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let resolved = false;

    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBodyBytes && !resolved) {
        resolved = true;
        request.destroy();
        resolve({ ok: false, reason: "body_too_large" });
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (resolved) {
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve({ ok: true, value: raw.trim() ? JSON.parse(raw) : {} });
      } catch {
        resolve({ ok: false, reason: "body_invalid_json" });
      }
    });
    request.on("error", () => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, reason: "body_invalid_json" });
      }
    });
  });
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

function normalizeBuyerAccount(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return CASPER_ACCOUNT_PATTERN.test(normalized) ? normalized : null;
}

function hasSensitiveRequirementKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasSensitiveRequirementKey);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      SENSITIVE_REQUIREMENT_KEY_PATTERN.test(key) || hasSensitiveRequirementKey(nested)
  );
}

function timeoutValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function nullableStringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return stringValue(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(record: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function firstValue(record: JsonObject, keys: string[]): unknown | null {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejected(reason: X402SignerRejectionReason): X402SignerValidation {
  return {
    ok: false,
    reason
  };
}

function hmacSha256(key: Buffer, value: Buffer): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function mod(value: bigint, by: bigint): bigint {
  const result = value % by;
  return result >= 0n ? result : result + by;
}

function modInverse(value: bigint, by: bigint): bigint {
  let low = mod(value, by);
  let high = by;
  let lowCoefficient = 1n;
  let highCoefficient = 0n;

  while (low > 1n) {
    const ratio = high / low;
    [low, high] = [high - low * ratio, low];
    [lowCoefficient, highCoefficient] = [
      highCoefficient - lowCoefficient * ratio,
      lowCoefficient
    ];
  }

  return mod(lowCoefficient, by);
}

function bytesToBigInt(value: Buffer): bigint {
  return BigInt(`0x${value.toString("hex") || "0"}`);
}

function bigIntToBuffer(value: bigint, length: number): Buffer {
  return Buffer.from(bigIntToFixedHex(value, length), "hex");
}

function bigIntToFixedHex(value: bigint, length: number): string {
  const hex = value.toString(16);
  if (hex.length > length * 2) {
    throw new Error("Integer does not fit fixed buffer");
  }

  return hex.padStart(length * 2, "0");
}

function leftPad(value: Buffer, length: number): Buffer {
  if (value.length > length) {
    throw new Error("Value does not fit fixed buffer");
  }

  if (value.length === length) {
    return value;
  }

  return Buffer.concat([Buffer.alloc(length - value.length), value]);
}

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
