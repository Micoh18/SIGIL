import {
  createPublicKey,
  verify as nodeVerify,
  type KeyObject
} from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CasperCommandRunner } from "../casper/anchorClient.js";
import { canonicalizeJson, toJsonObject, toJsonValue } from "../memory/canonical.js";
import { sha256Hex } from "../memory/hash.js";
import type { JsonObject, JsonValue } from "../memory/types.js";
import {
  CasperCliX402SettlementProvider,
  createSignedPayloadHash,
  type X402CasperCliSettlementConfig,
  type X402SignedPaymentProvider,
  type X402SettlementInput,
  type X402SettlementOutcome
} from "./settlement.js";

const MAX_BODY_BYTES = 64 * 1024;
const HASH_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const HTTP_METHOD_PATTERN = /^[A-Za-z]+$/;
const SECP256K1_P = BigInt(
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"
);

export type X402FacilitatorLogger = {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
};

export type X402FacilitatorHttpServerConfig = {
  facilitatorUrl?: string | null;
  settlementConfig: X402CasperCliSettlementConfig;
  commandRunner?: CasperCommandRunner;
  replayStore?: X402FacilitatorReplayStore;
  now?: () => Date;
  logger?: X402FacilitatorLogger;
  maxBodyBytes?: number;
};

export type X402FacilitatorReplayState = "verified" | "settling" | "settled" | "failed";

export type X402FacilitatorReplayRecord = {
  replayKey: string;
  payloadHash: string;
  state: X402FacilitatorReplayState;
  transactionHash: string | null;
  updatedAt: string;
};

export type X402FacilitatorReplayStore = {
  reserveVerify(payment: ValidatedX402FacilitatorPayment): X402ReplayReservation;
  reserveSettle(payment: ValidatedX402FacilitatorPayment): X402ReplayReservation;
  completeSettle(
    payment: ValidatedX402FacilitatorPayment,
    state: "settled" | "failed",
    transactionHash: string | null
  ): void;
};

export type X402ReplayReservation =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: "payment_payload_replayed" | "nonce_replayed" | "payment_settlement_in_progress";
    };

type X402ReplayRejectionReason = Extract<X402ReplayReservation, { ok: false }>["reason"];

export type X402FacilitatorRejectionReason =
  | "request_not_object"
  | "payment_payload_missing"
  | "payment_requirements_missing"
  | "payment_requirements_no_matching_accept"
  | "selected_requirement_hash_missing"
  | "selected_requirement_hash_invalid"
  | "selected_requirement_hash_mismatch"
  | "accepted_requirement_hash_mismatch"
  | "scheme_missing"
  | "scheme_unsupported"
  | "network_missing"
  | "network_mismatch"
  | "amount_missing"
  | "amount_invalid"
  | "amount_mismatch"
  | "resource_missing"
  | "resource_mismatch"
  | "method_missing"
  | "method_invalid"
  | "method_mismatch"
  | "asset_missing"
  | "asset_mismatch"
  | "payee_missing"
  | "payee_mismatch"
  | "payer_missing"
  | "authorization_missing"
  | "payment_id_missing"
  | "payment_id_invalid"
  | "policy_hash_missing"
  | "policy_hash_invalid"
  | "public_key_missing"
  | "public_key_invalid"
  | "signature_missing"
  | "signature_invalid"
  | "authorization_hash_mismatch"
  | "nonce_missing"
  | "nonce_invalid"
  | "nonce_mismatch"
  | "valid_after_missing"
  | "valid_until_missing"
  | "validity_window_invalid"
  | "payment_not_yet_valid"
  | "payment_expired"
  | "timeout_missing"
  | "timeout_invalid"
  | "timeout_exceeded";

export type ValidatedX402FacilitatorPayment = {
  paymentPayload: JsonObject;
  paymentRequirements: JsonObject;
  selectedRequirementHash: string;
  payloadHash: string;
  replayKey: string;
  nonce: string;
  paymentId: string;
  policyHash: string;
  payer: string;
  publicKey: string;
  signature: string;
  requirement: NormalizedFacilitatorRequirement;
  settlementInput: X402SettlementInput;
};

type NormalizedFacilitatorRequirement = {
  scheme: "exact";
  network: string;
  amount: string;
  resource: string;
  method: string;
  asset: string;
  payTo: string;
  timeoutSeconds: number;
};

type X402FacilitatorPaymentValidation =
  | {
      ok: true;
      payment: ValidatedX402FacilitatorPayment;
    }
  | {
      ok: false;
      reason: X402FacilitatorRejectionReason;
      statusCode: number;
    };

type AuthorizationToSign = {
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
  nonce: string;
};

export class InMemoryX402FacilitatorReplayStore implements X402FacilitatorReplayStore {
  private readonly records = new Map<string, X402FacilitatorReplayRecord>();

  reserveVerify(payment: ValidatedX402FacilitatorPayment): X402ReplayReservation {
    const existing = this.records.get(payment.replayKey);
    if (existing) {
      return {
        ok: false,
        reason:
          existing.payloadHash === payment.payloadHash
            ? "payment_payload_replayed"
            : "nonce_replayed"
      };
    }

    this.records.set(payment.replayKey, replayRecord(payment, "verified", null));
    return { ok: true };
  }

  reserveSettle(payment: ValidatedX402FacilitatorPayment): X402ReplayReservation {
    const existing = this.records.get(payment.replayKey);
    if (!existing) {
      this.records.set(payment.replayKey, replayRecord(payment, "settling", null));
      return { ok: true };
    }

    if (existing.state === "verified" && existing.payloadHash === payment.payloadHash) {
      this.records.set(payment.replayKey, replayRecord(payment, "settling", null));
      return { ok: true };
    }

    return {
      ok: false,
      reason:
        existing.state === "settling"
          ? "payment_settlement_in_progress"
          : existing.payloadHash === payment.payloadHash
            ? "payment_payload_replayed"
            : "nonce_replayed"
    };
  }

  completeSettle(
    payment: ValidatedX402FacilitatorPayment,
    state: "settled" | "failed",
    transactionHash: string | null
  ): void {
    this.records.set(payment.replayKey, replayRecord(payment, state, transactionHash));
  }
}

export function createX402FacilitatorHttpServer(
  config: X402FacilitatorHttpServerConfig
): Server {
  const replayStore = config.replayStore ?? new InMemoryX402FacilitatorReplayStore();

  return createServer(async (request, response) => {
    try {
      await handleX402FacilitatorHttpRequest(request, response, config, replayStore);
    } catch (error) {
      config.logger?.error?.(`x402 facilitator request failed: ${errorMessage(error)}`);
      sendJson(response, 500, {
        success: false,
        settled: false,
        error: "facilitator_failed"
      });
    }
  });
}

export function validateX402FacilitatorPayment(
  input: unknown,
  options: {
    expectedNetwork?: string | null;
    now?: () => Date;
    facilitatorUrl?: string | null;
  } = {}
): X402FacilitatorPaymentValidation {
  const body = asRecord(input);
  if (!body) {
    return rejected("request_not_object");
  }

  let paymentPayload: JsonObject;
  try {
    paymentPayload = toJsonObject(
      body.paymentPayload ?? body.payment_payload,
      "paymentPayload"
    );
  } catch {
    return rejected("payment_payload_missing");
  }

  const selectedRequirementHash = firstString(paymentPayload, [
    "selectedRequirementHash",
    "selected_requirement_hash"
  ]);
  if (!selectedRequirementHash) {
    return rejected("selected_requirement_hash_missing");
  }
  if (!HASH_HEX_PATTERN.test(selectedRequirementHash)) {
    return rejected("selected_requirement_hash_invalid");
  }

  const paymentRequirements = extractSelectedPaymentRequirements(
    body.paymentRequirements ?? body.payment_requirements ?? body.selectedRequirement,
    selectedRequirementHash.toLowerCase()
  );
  if (!paymentRequirements.ok) {
    return rejected(paymentRequirements.reason);
  }

  const actualRequirementHash = sha256Hex(canonicalizeJson(paymentRequirements.value));
  if (actualRequirementHash !== selectedRequirementHash.toLowerCase()) {
    return rejected("selected_requirement_hash_mismatch");
  }

  const accepted = asRecord(paymentPayload.accepted);
  if (accepted) {
    const acceptedHash = sha256Hex(canonicalizeJson(accepted));
    if (acceptedHash !== selectedRequirementHash.toLowerCase()) {
      return rejected("accepted_requirement_hash_mismatch");
    }
  }

  const requirement = normalizeRequirement(paymentRequirements.value);
  if (!requirement.ok) {
    return rejected(requirement.reason);
  }
  if (
    options.expectedNetwork &&
    !networkMatches(requirement.value.network, options.expectedNetwork)
  ) {
    return rejected("network_mismatch");
  }

  const authorization = asRecord(paymentPayload.authorization);
  if (!authorization) {
    return rejected("authorization_missing");
  }

  const payer = firstString(paymentPayload, ["payer", "payerAccount", "payer_account"]);
  if (!payer) {
    return rejected("payer_missing");
  }

  const paymentId =
    firstString(authorization, ["paymentId", "payment_id"]) ??
    firstString(paymentPayload, ["paymentId", "payment_id"]);
  if (!paymentId) {
    return rejected("payment_id_missing");
  }
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(paymentId)) {
    return rejected("payment_id_invalid");
  }

  const policyHash =
    firstString(authorization, ["policyHash", "policy_hash"]) ??
    firstString(paymentPayload, ["policyHash", "policy_hash"]);
  if (!policyHash) {
    return rejected("policy_hash_missing");
  }
  if (!HASH_HEX_PATTERN.test(policyHash)) {
    return rejected("policy_hash_invalid");
  }

  const publicKey = firstString(authorization, ["publicKey", "public_key"]);
  if (!publicKey) {
    return rejected("public_key_missing");
  }
  if (!validCasperPublicKey(publicKey)) {
    return rejected("public_key_invalid");
  }

  const signature = firstString(authorization, ["signature"]);
  if (!signature) {
    return rejected("signature_missing");
  }

  const payloadNonce = firstString(paymentPayload, ["nonce"]);
  const authorizationNonce = firstString(authorization, ["nonce"]);
  if (!payloadNonce && !authorizationNonce) {
    return rejected("nonce_missing");
  }
  if (payloadNonce && authorizationNonce && payloadNonce !== authorizationNonce) {
    return rejected("nonce_mismatch");
  }
  const nonce = normalizeHex(payloadNonce ?? authorizationNonce, 64);
  if (!nonce) {
    return rejected("nonce_invalid");
  }

  const validAfter = firstString(paymentPayload, [
    "validAfter",
    "valid_after",
    "validFrom",
    "valid_from"
  ]);
  if (!validAfter) {
    return rejected("valid_after_missing");
  }

  const validUntil =
    firstString(paymentPayload, [
      "validUntil",
      "valid_until",
      "validBefore",
      "valid_before",
      "expiresAt",
      "expires_at"
    ]) ?? firstString(authorization, ["validBefore", "valid_before"]);
  if (!validUntil) {
    return rejected("valid_until_missing");
  }

  const validity = validateValidityWindow({
    validAfter,
    validUntil,
    timeoutSeconds: requirement.value.timeoutSeconds,
    now: options.now?.() ?? new Date()
  });
  if (!validity.ok) {
    return rejected(validity.reason);
  }

  const fieldCheck = validatePayloadRequirementFields({
    paymentPayload,
    authorization,
    requirement: requirement.value,
    payer,
    publicKey,
    nonce
  });
  if (!fieldCheck.ok) {
    return rejected(fieldCheck.reason);
  }

  const authorizationToSign: AuthorizationToSign = {
    domain: "casper-x402-authorization",
    version: 1,
    paymentId,
    policyHash: policyHash.toLowerCase(),
    selectedRequirementHash: selectedRequirementHash.toLowerCase(),
    method: requirement.value.method,
    resource: requirement.value.resource,
    scheme: requirement.value.scheme,
    network: requirement.value.network,
    asset: requirement.value.asset,
    payTo: requirement.value.payTo,
    amount: requirement.value.amount,
    payer,
    publicKey: publicKey.toLowerCase(),
    validAfter,
    validBefore: validUntil,
    nonce
  };
  const canonicalAuthorization = canonicalizeJson(authorizationToSign);
  const authorizationHash = firstString(authorization, [
    "authorizationHash",
    "authorization_hash"
  ]);
  if (authorizationHash && authorizationHash !== sha256Hex(canonicalAuthorization)) {
    return rejected("authorization_hash_mismatch");
  }

  if (
    !verifyCasperPayloadSignature({
      publicKey,
      signature,
      canonicalAuthorization
    })
  ) {
    return rejected("signature_invalid");
  }

  const payloadHash = createSignedPayloadHash(paymentPayload);
  const replayKey = sha256Hex(
    [
      requirement.value.network.toLowerCase(),
      payer.toLowerCase(),
      nonce
    ].join(":")
  );

  return {
    ok: true,
    payment: {
      paymentPayload,
      paymentRequirements: paymentRequirements.value,
      selectedRequirementHash: selectedRequirementHash.toLowerCase(),
      payloadHash,
      replayKey,
      nonce,
      paymentId,
      policyHash: policyHash.toLowerCase(),
      payer,
      publicKey: publicKey.toLowerCase(),
      signature: signature.toLowerCase(),
      requirement: requirement.value,
      settlementInput: {
        payment_id: paymentId,
        facilitator_url: options.facilitatorUrl ?? null,
        method: requirement.value.method,
        url: requirement.value.resource,
        selected_requirement: paymentRequirements.value,
        selected_requirement_hash: selectedRequirementHash.toLowerCase(),
        policy_hash: policyHash.toLowerCase()
      }
    }
  };
}

async function handleX402FacilitatorHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: X402FacilitatorHttpServerConfig,
  replayStore: X402FacilitatorReplayStore
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method !== "POST" || (pathname !== "/verify" && pathname !== "/settle")) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  const body = await readJsonBody(request, config.maxBodyBytes ?? MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(response, 400, {
      success: false,
      settled: false,
      valid: false,
      error: "invalid_json",
      reason: body.reason
    });
    return;
  }

  const validation = validateX402FacilitatorPayment(body.value, {
    expectedNetwork: config.settlementConfig.caip2ChainId,
    facilitatorUrl: config.facilitatorUrl,
    now: config.now
  });
  if (!validation.ok) {
    config.logger?.warn?.(`x402 facilitator rejected reason=${validation.reason}`);
    sendJson(response, validation.statusCode, {
      success: false,
      settled: false,
      valid: false,
      error: "invalid_payment",
      reason: validation.reason
    });
    return;
  }

  if (pathname === "/verify") {
    const reservation = replayStore.reserveVerify(validation.payment);
    if (!reservation.ok) {
      sendReplayRejection(response, reservation.reason);
      return;
    }

    config.logger?.info?.(
      `x402 facilitator verified payment_id=${validation.payment.paymentId} selected_requirement_hash=${validation.payment.selectedRequirementHash} payload_hash=${validation.payment.payloadHash}`
    );
    sendJson(response, 200, {
      valid: true,
      selectedRequirementHash: validation.payment.selectedRequirementHash,
      network: validation.payment.requirement.network,
      asset: validation.payment.requirement.asset,
      amount: validation.payment.requirement.amount,
      payer: validation.payment.payer,
      payTo: validation.payment.requirement.payTo
    });
    return;
  }

  const reservation = replayStore.reserveSettle(validation.payment);
  if (!reservation.ok) {
    sendReplayRejection(response, reservation.reason);
    return;
  }

  const settlement = await settleValidatedPayment(validation.payment, config);
  if (settlement.status === "settled") {
    replayStore.completeSettle(
      validation.payment,
      "settled",
      settlement.casper_transaction_hash
    );
    config.logger?.info?.(
      `x402 facilitator settled payment_id=${validation.payment.paymentId} transaction_hash=${settlement.casper_transaction_hash}`
    );
    sendJson(response, 200, settlementSuccessResponse(validation.payment, settlement));
    return;
  }

  replayStore.completeSettle(
    validation.payment,
    "failed",
    settlement.casper_transaction_hash
  );
  config.logger?.warn?.(
    `x402 facilitator settlement failed payment_id=${validation.payment.paymentId} blocker=${settlement.blocker}`
  );
  sendJson(
    response,
    settlement.status === "unavailable" ? 503 : 200,
    settlementFailedResponse(validation.payment, settlement)
  );
}

async function settleValidatedPayment(
  payment: ValidatedX402FacilitatorPayment,
  config: X402FacilitatorHttpServerConfig
): Promise<X402SettlementOutcome> {
  const signer: X402SignedPaymentProvider = {
    async sign() {
      return {
        signed: true,
        signed_payload: payment.paymentPayload,
        signed_payload_hash: payment.payloadHash
      };
    }
  };
  const provider = new CasperCliX402SettlementProvider(
    signer,
    {
      ...config.settlementConfig,
      now: config.settlementConfig.now ?? config.now
    },
    config.commandRunner
  );

  return provider.settle(payment.settlementInput);
}

function settlementSuccessResponse(
  payment: ValidatedX402FacilitatorPayment,
  settlement: Extract<X402SettlementOutcome, { status: "settled" }>
): JsonObject {
  return {
    success: true,
    settled: true,
    transactionHash: settlement.casper_transaction_hash,
    transaction: settlement.casper_transaction_hash,
    network: payment.requirement.network,
    asset: payment.requirement.asset,
    amount: payment.requirement.amount,
    payer: payment.payer,
    payTo: payment.requirement.payTo,
    receipt: receiptJsonValue(settlement.receipt_json)
  };
}

function settlementFailedResponse(
  payment: ValidatedX402FacilitatorPayment,
  settlement: Exclude<X402SettlementOutcome, { status: "settled" }>
): JsonObject {
  return {
    success: false,
    settled: false,
    error: settlement.status === "unavailable" ? "settlement_unavailable" : "settlement_failed",
    reason: settlement.blocker,
    transactionHash: settlement.casper_transaction_hash,
    transaction: settlement.casper_transaction_hash,
    network: payment.requirement.network,
    asset: payment.requirement.asset,
    amount: payment.requirement.amount,
    payer: payment.payer,
    payTo: payment.requirement.payTo,
    receipt: receiptJsonValue(settlement.receipt_json)
  };
}

function sendReplayRejection(
  response: ServerResponse,
  reason: X402ReplayRejectionReason
): void {
  sendJson(response, 409, {
    success: false,
    settled: false,
    valid: false,
    error: "payment_replayed",
    reason
  });
}

function validatePayloadRequirementFields(input: {
  paymentPayload: JsonObject;
  authorization: Record<string, unknown>;
  requirement: NormalizedFacilitatorRequirement;
  payer: string;
  publicKey: string;
  nonce: string;
}):
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: X402FacilitatorRejectionReason;
    } {
  const checks: Array<{
    value: string | null;
    expected: string;
    reason: X402FacilitatorRejectionReason;
  }> = [
    {
      value: firstString(input.paymentPayload, ["scheme"]) ?? firstString(input.authorization, ["scheme"]),
      expected: input.requirement.scheme,
      reason: "scheme_unsupported"
    },
    {
      value: firstString(input.paymentPayload, ["network"]) ?? firstString(input.authorization, ["network"]),
      expected: input.requirement.network,
      reason: "network_mismatch"
    },
    {
      value: firstString(input.paymentPayload, ["method"]) ?? firstString(input.authorization, ["method"]),
      expected: input.requirement.method,
      reason: "method_mismatch"
    },
    {
      value: firstString(input.paymentPayload, ["resource"]) ?? firstString(input.authorization, ["resource"]),
      expected: input.requirement.resource,
      reason: "resource_mismatch"
    },
    {
      value: firstString(input.paymentPayload, ["asset"]) ?? firstString(input.authorization, ["asset"]),
      expected: input.requirement.asset,
      reason: "asset_mismatch"
    },
    {
      value:
        firstString(input.paymentPayload, ["payTo", "pay_to", "payee"]) ??
        firstString(input.authorization, ["payTo", "pay_to", "to"]),
      expected: input.requirement.payTo,
      reason: "payee_mismatch"
    },
    {
      value:
        firstString(input.paymentPayload, ["amount", "maxAmountRequired", "max_amount_required"]) ??
        firstString(input.authorization, ["amount", "value"]),
      expected: input.requirement.amount,
      reason: "amount_mismatch"
    },
    {
      value: firstString(input.authorization, ["payer", "from"]),
      expected: input.payer,
      reason: "payer_missing"
    },
    {
      value: firstString(input.authorization, ["publicKey", "public_key"]),
      expected: input.publicKey,
      reason: "public_key_invalid"
    },
    {
      value: firstString(input.authorization, ["nonce"]),
      expected: input.nonce,
      reason: "nonce_mismatch"
    }
  ];

  for (const check of checks) {
    if (check.value && !matchesNormalized(check.value, check.expected)) {
      return { ok: false, reason: check.reason };
    }
  }

  return { ok: true };
}

function normalizeRequirement(
  requirement: JsonObject
):
  | {
      ok: true;
      value: NormalizedFacilitatorRequirement;
    }
  | {
      ok: false;
      reason: X402FacilitatorRejectionReason;
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
  if (!UNSIGNED_INTEGER_PATTERN.test(amount)) {
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

function extractSelectedPaymentRequirements(
  value: unknown,
  selectedRequirementHash: string
):
  | {
      ok: true;
      value: JsonObject;
    }
  | {
      ok: false;
      reason: "payment_requirements_missing" | "payment_requirements_no_matching_accept";
    } {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, reason: "payment_requirements_missing" };
  }

  if (!Array.isArray(record.accepts)) {
    return { ok: true, value: toJsonObject(record, "paymentRequirements") };
  }

  for (const item of record.accepts) {
    const candidate = asRecord(item);
    if (!candidate) {
      continue;
    }
    const candidateObject = toJsonObject(candidate, "paymentRequirements.accepts[]");
    if (sha256Hex(canonicalizeJson(candidateObject)) === selectedRequirementHash) {
      return { ok: true, value: candidateObject };
    }
  }

  return { ok: false, reason: "payment_requirements_no_matching_accept" };
}

function validateValidityWindow(input: {
  validAfter: string;
  validUntil: string;
  timeoutSeconds: number;
  now: Date;
}):
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: X402FacilitatorRejectionReason;
    } {
  const validAfterMs = Date.parse(input.validAfter);
  const validUntilMs = Date.parse(input.validUntil);
  if (
    !Number.isFinite(validAfterMs) ||
    !Number.isFinite(validUntilMs) ||
    validUntilMs <= validAfterMs
  ) {
    return { ok: false, reason: "validity_window_invalid" };
  }

  const nowMs = input.now.getTime();
  if (validAfterMs > nowMs) {
    return { ok: false, reason: "payment_not_yet_valid" };
  }
  if (validUntilMs <= nowMs) {
    return { ok: false, reason: "payment_expired" };
  }
  if (validUntilMs - validAfterMs > input.timeoutSeconds * 1000) {
    return { ok: false, reason: "timeout_exceeded" };
  }

  return { ok: true };
}

function verifyCasperPayloadSignature(input: {
  publicKey: string;
  signature: string;
  canonicalAuthorization: string;
}): boolean {
  const publicKey = normalizeHex(input.publicKey, null);
  const signature = normalizeHex(input.signature, null);
  if (!publicKey || !signature) {
    return false;
  }

  const authorizationBytes = Buffer.from(input.canonicalAuthorization, "utf8");

  try {
    if (publicKey.startsWith("01") && signature.startsWith("01")) {
      const publicKeyObject = createEd25519PublicKey(publicKey.slice(2));
      return nodeVerify(
        null,
        authorizationBytes,
        publicKeyObject,
        Buffer.from(signature.slice(2), "hex")
      );
    }

    if (publicKey.startsWith("02") && signature.startsWith("02")) {
      const publicKeyObject = createSecp256k1PublicKey(publicKey.slice(2));
      if (!publicKeyObject) {
        return false;
      }

      return nodeVerify(
        "sha256",
        authorizationBytes,
        { key: publicKeyObject, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature.slice(2), "hex")
      );
    }
  } catch {
    return false;
  }

  return false;
}

function createEd25519PublicKey(rawHex: string): KeyObject {
  return createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(rawHex, "hex").toString("base64url")
    },
    format: "jwk"
  });
}

function createSecp256k1PublicKey(compressedHex: string): KeyObject | null {
  const point = decompressSecp256k1PublicKey(compressedHex);
  if (!point) {
    return null;
  }

  return createPublicKey({
    key: {
      kty: "EC",
      crv: "secp256k1",
      x: bigIntToBuffer(point.x, 32).toString("base64url"),
      y: bigIntToBuffer(point.y, 32).toString("base64url")
    },
    format: "jwk"
  });
}

function decompressSecp256k1PublicKey(
  compressedHex: string
): { x: bigint; y: bigint } | null {
  if (!/^(02|03)[a-f0-9]{64}$/i.test(compressedHex)) {
    return null;
  }

  const prefix = compressedHex.slice(0, 2);
  const x = BigInt(`0x${compressedHex.slice(2)}`);
  const alpha = mod(x ** 3n + 7n, SECP256K1_P);
  const beta = modPow(alpha, (SECP256K1_P + 1n) / 4n, SECP256K1_P);
  const betaIsOdd = Boolean(beta & 1n);
  const wantOdd = prefix === "03";
  const y = betaIsOdd === wantOdd ? beta : SECP256K1_P - beta;

  return { x, y };
}

function receiptJsonValue(receiptJson: string): JsonValue {
  try {
    return toJsonValue(JSON.parse(receiptJson) as unknown, "receipt");
  } catch {
    return { raw: receiptJson };
  }
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

function replayRecord(
  payment: ValidatedX402FacilitatorPayment,
  state: X402FacilitatorReplayState,
  transactionHash: string | null
): X402FacilitatorReplayRecord {
  return {
    replayKey: payment.replayKey,
    payloadHash: payment.payloadHash,
    state,
    transactionHash,
    updatedAt: new Date().toISOString()
  };
}

function rejected(reason: X402FacilitatorRejectionReason): X402FacilitatorPaymentValidation {
  return {
    ok: false,
    reason,
    statusCode: reason.includes("missing") ? 400 : 422
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(
  record: Record<string, unknown> | JsonObject | null | undefined,
  keys: string[]
): string | null {
  if (!record) {
    return null;
  }

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

function normalizeHex(value: string | null, length: number | null): string | null {
  const normalized = value?.toLowerCase().replace(/^0x/, "");
  if (!normalized) {
    return null;
  }

  const pattern = length === null ? /^[a-f0-9]+$/ : new RegExp(`^[a-f0-9]{${length}}$`);
  return pattern.test(normalized) ? normalized : null;
}

function validCasperPublicKey(value: string): boolean {
  const normalized = normalizeHex(value, null);
  if (!normalized) {
    return false;
  }

  return /^01[a-f0-9]{64}$/.test(normalized) || /^02(02|03)[a-f0-9]{64}$/.test(normalized);
}

function matchesNormalized(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function networkMatches(left: string, right: string): boolean {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftSuffix = normalizedLeft.split(":").at(-1);
  const rightSuffix = normalizedRight.split(":").at(-1);
  return Boolean(leftSuffix && rightSuffix && leftSuffix === rightSuffix);
}

function mod(value: bigint, by: bigint): bigint {
  const result = value % by;
  return result >= 0n ? result : result + by;
}

function modPow(value: bigint, exponent: bigint, by: bigint): bigint {
  let result = 1n;
  let base = mod(value, by);
  let remaining = exponent;

  while (remaining > 0n) {
    if (remaining & 1n) {
      result = mod(result * base, by);
    }
    base = mod(base * base, by);
    remaining >>= 1n;
  }

  return result;
}

function bigIntToBuffer(value: bigint, length: number): Buffer {
  const hex = value.toString(16);
  if (hex.length > length * 2) {
    throw new Error("Integer does not fit fixed buffer");
  }

  return Buffer.from(hex.padStart(length * 2, "0"), "hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
