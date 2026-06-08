import { canonicalizeJson, toJsonObject } from "../memory/canonical.js";
import { sha256Hex } from "../memory/hash.js";
import type { JsonObject } from "../memory/types.js";
import type { PolicyRecord } from "../grimoire/types.js";
import { redactX402Value } from "./redaction.js";
import {
  compareDecimal,
  networkMatches,
  normalizePaymentAmountForComparison,
  parseDecimalAmount,
  type DecimalAmount
} from "./normalization.js";

export type X402RequirementApprovalInput = {
  requirements: unknown;
  policy: PolicyRecord;
  method: string;
  url: string;
  expectedAmount: string | null;
};

export type X402RequirementCandidateRejection = {
  index: number;
  reason: X402RequirementCandidateRejectionReason;
};

export type X402RequirementCandidateRejectionReason =
  | "requirement_not_object"
  | "amount_missing"
  | "amount_invalid"
  | "expected_amount_mismatch"
  | "amount_over_limit"
  | "resource_missing"
  | "resource_mismatch"
  | "method_missing"
  | "method_mismatch"
  | "network_missing"
  | "network_mismatch"
  | "asset_missing"
  | "asset_mismatch"
  | "payee_missing"
  | "payee_mismatch"
  | "scheme_missing"
  | "scheme_mismatch"
  | "timeout_missing"
  | "timeout_invalid";

export type X402RequirementRejectionReason =
  | "requirements_not_object"
  | "requirements_accepts_missing"
  | "requirements_accepts_empty"
  | "invalid_policy_amount"
  | "invalid_expected_amount"
  | "no_acceptable_requirement";

export type X402RequirementApproval =
  | {
      approved: true;
      selected_index: number;
      selected_requirement_hash: string;
      selected_requirement: JsonObject;
    }
  | {
      approved: false;
      reason: X402RequirementRejectionReason;
      rejected_candidates: X402RequirementCandidateRejection[];
    };

export type X402SettlementResponseVerification =
  | {
      settled: true;
      settlement_status: "settled";
      transaction_hash: string;
      receipt_json: string;
    }
  | {
      settled: false;
      settlement_status: "not_settled";
      reason:
        | "settlement_response_not_object"
        | "settlement_response_not_successful"
        | "settlement_transaction_hash_missing"
        | "settlement_network_missing"
        | "settlement_network_mismatch"
        | "settlement_asset_missing"
        | "settlement_asset_mismatch"
        | "settlement_amount_missing"
        | "settlement_amount_invalid"
        | "settlement_amount_mismatch"
        | "settlement_payer_missing"
        | "settlement_payer_mismatch"
        | "settlement_payee_missing"
        | "settlement_payee_mismatch";
      receipt_json: string | null;
    };

export type X402PaymentPayloadRejectionReason =
  | "payment_payload_not_object"
  | "payer_missing"
  | "authorization_missing"
  | "nonce_missing"
  | "valid_after_missing"
  | "valid_until_missing"
  | "validity_window_invalid"
  | "payment_not_yet_valid"
  | "payment_expired"
  | "validity_window_too_long"
  | "selected_requirement_hash_missing"
  | "selected_requirement_hash_mismatch";

export type X402PaymentPayloadApproval =
  | {
      approved: true;
    }
  | {
      approved: false;
      reason: X402PaymentPayloadRejectionReason;
    };

export type X402SettlementResponseExpectation = {
  selectedRequirement?: JsonObject;
  signedPayload?: JsonObject;
};

export type X402PaymentPayloadValidationOptions = {
  now?: Date;
  clockSkewSeconds?: number;
  maxValiditySeconds?: number | null;
};

export function approveX402Requirements(
  input: X402RequirementApprovalInput
): X402RequirementApproval {
  const requirements = asRecord(input.requirements);
  if (!requirements) {
    return rejected("requirements_not_object");
  }

  const accepts = requirements.accepts;
  if (!Array.isArray(accepts)) {
    return rejected("requirements_accepts_missing");
  }

  if (accepts.length === 0) {
    return rejected("requirements_accepts_empty");
  }

  if (!parseDecimalAmount(input.policy.max_amount_per_call)) {
    return rejected("invalid_policy_amount");
  }

  const expectedAmount =
    input.expectedAmount === null ? null : parseDecimalAmount(input.expectedAmount);
  if (input.expectedAmount !== null && !expectedAmount) {
    return rejected("invalid_expected_amount");
  }

  const rejectedCandidates: X402RequirementCandidateRejection[] = [];

  for (const [index, item] of accepts.entries()) {
    const candidate = asRecord(item);
    if (!candidate) {
      rejectedCandidates.push({ index, reason: "requirement_not_object" });
      continue;
    }

    const reason = validateRequirementCandidate({
      candidate,
      index,
      policy: input.policy,
      policyMax: input.policy.max_amount_per_call,
      expectedAmount,
      expectedAmountRaw: input.expectedAmount,
      method: input.method.toUpperCase(),
      url: input.url
    });

    if (reason) {
      rejectedCandidates.push({ index, reason });
      continue;
    }

    const selectedRequirement = toJsonObject(candidate, "payment_requirement");
    return {
      approved: true,
      selected_index: index,
      selected_requirement: selectedRequirement,
      selected_requirement_hash: sha256Hex(canonicalizeJson(selectedRequirement))
    };
  }

  return {
    approved: false,
    reason: "no_acceptable_requirement",
    rejected_candidates: rejectedCandidates
  };
}

export function validateX402PaymentPayload(
  paymentPayload: unknown,
  selectedRequirementHash: string,
  options: X402PaymentPayloadValidationOptions = {}
): X402PaymentPayloadApproval {
  const payload = asRecord(paymentPayload);
  if (!payload) {
    return { approved: false, reason: "payment_payload_not_object" };
  }

  if (!firstString(payload, ["payer", "payerAccount", "payer_account"])) {
    return { approved: false, reason: "payer_missing" };
  }

  if (!asRecord(payload.authorization)) {
    return { approved: false, reason: "authorization_missing" };
  }

  if (!firstString(payload, ["nonce"])) {
    return { approved: false, reason: "nonce_missing" };
  }

  const validAfter = firstString(payload, ["validAfter", "valid_after", "validFrom", "valid_from"]);
  if (!validAfter) {
    return { approved: false, reason: "valid_after_missing" };
  }

  const validUntil = firstString(payload, [
    "validUntil",
    "valid_until",
    "validBefore",
    "valid_before",
    "expiresAt",
    "expires_at"
  ]);
  if (!validUntil) {
    return { approved: false, reason: "valid_until_missing" };
  }

  const validAfterMs = Date.parse(validAfter);
  const validUntilMs = Date.parse(validUntil);
  if (
    !Number.isFinite(validAfterMs) ||
    !Number.isFinite(validUntilMs) ||
    validUntilMs <= validAfterMs
  ) {
    return { approved: false, reason: "validity_window_invalid" };
  }

  if (options.now) {
    const skewMs = Math.max(0, options.clockSkewSeconds ?? 0) * 1000;
    const nowMs = options.now.getTime();
    if (validAfterMs > nowMs + skewMs) {
      return { approved: false, reason: "payment_not_yet_valid" };
    }
    if (validUntilMs <= nowMs - skewMs) {
      return { approved: false, reason: "payment_expired" };
    }
  }

  if (
    options.maxValiditySeconds !== null &&
    options.maxValiditySeconds !== undefined &&
    validUntilMs - validAfterMs > options.maxValiditySeconds * 1000
  ) {
    return { approved: false, reason: "validity_window_too_long" };
  }

  const payloadHash = firstString(payload, [
    "selectedRequirementHash",
    "selected_requirement_hash"
  ]);
  if (!payloadHash) {
    return { approved: false, reason: "selected_requirement_hash_missing" };
  }

  if (payloadHash !== selectedRequirementHash) {
    return { approved: false, reason: "selected_requirement_hash_mismatch" };
  }

  return { approved: true };
}

export function verifyX402SettlementResponse(
  settlementResponse: unknown,
  expectation: X402SettlementResponseExpectation = {}
): X402SettlementResponseVerification {
  const response = asRecord(settlementResponse);
  if (!response) {
    return {
      settled: false,
      settlement_status: "not_settled",
      reason: "settlement_response_not_object",
      receipt_json: null
    };
  }

  const receipt = toJsonObject(redactX402Value(response), "settlement_response");
  const receiptJson = JSON.stringify(receipt);
  const successful = response.success === true || response.settled === true;

  if (!successful) {
    return {
      settled: false,
      settlement_status: "not_settled",
      reason: "settlement_response_not_successful",
      receipt_json: receiptJson
    };
  }

  const transactionHash = firstString(response, [
    "transactionHash",
    "transaction_hash",
    "txHash",
    "tx_hash",
    "transaction"
  ]);

  if (!transactionHash) {
    return {
      settled: false,
      settlement_status: "not_settled",
      reason: "settlement_transaction_hash_missing",
      receipt_json: receiptJson
    };
  }

  const expectedNetwork = expectation.selectedRequirement
    ? firstString(expectation.selectedRequirement, ["network", "networkId", "network_id"])
    : null;
  const network = firstString(response, ["network", "networkId", "network_id"]);
  if (!network) {
    return notSettled("settlement_network_missing", receiptJson);
  }
  if (expectedNetwork && !networkMatches(network, expectedNetwork)) {
    return notSettled("settlement_network_mismatch", receiptJson);
  }

  const expectedAsset = expectation.selectedRequirement
    ? firstString(expectation.selectedRequirement, ["asset", "assetPackage", "asset_package"])
    : null;
  const asset = firstString(response, ["asset", "assetPackage", "asset_package"]);
  if (!asset) {
    return notSettled("settlement_asset_missing", receiptJson);
  }
  if (expectedAsset && !matchesAny(asset, [expectedAsset])) {
    return notSettled("settlement_asset_mismatch", receiptJson);
  }

  const expectedAmount = expectation.selectedRequirement
    ? firstString(expectation.selectedRequirement, [
        "amount",
        "maxAmountRequired",
        "max_amount_required"
      ])
    : null;
  const amount = firstString(response, ["amount", "maxAmountRequired", "max_amount_required"]);
  if (!amount) {
    return notSettled("settlement_amount_missing", receiptJson);
  }

  const responseAmount = parseDecimalAmount(amount);
  if (!responseAmount) {
    return notSettled("settlement_amount_invalid", receiptJson);
  }
  if (expectedAmount) {
    const expected = parseDecimalAmount(expectedAmount);
    if (!expected || compareDecimal(responseAmount, expected) !== 0) {
      return notSettled("settlement_amount_mismatch", receiptJson);
    }
  }

  const expectedPayer = expectation.signedPayload
    ? firstString(expectation.signedPayload, ["payer", "payerAccount", "payer_account"])
    : null;
  const payer = firstString(response, ["payer", "payerAccount", "payer_account"]);
  if (!payer) {
    return notSettled("settlement_payer_missing", receiptJson);
  }
  if (expectedPayer && !matchesAny(payer, [expectedPayer])) {
    return notSettled("settlement_payer_mismatch", receiptJson);
  }

  const expectedPayee = expectation.selectedRequirement
    ? firstString(expectation.selectedRequirement, ["payTo", "pay_to", "payee"])
    : null;
  const payee = firstString(response, ["payTo", "pay_to", "payee"]);
  if (!payee) {
    return notSettled("settlement_payee_missing", receiptJson);
  }
  if (expectedPayee && !matchesAny(payee, [expectedPayee])) {
    return notSettled("settlement_payee_mismatch", receiptJson);
  }

  return {
    settled: true,
    settlement_status: "settled",
    transaction_hash: transactionHash,
    receipt_json: receiptJson
  };
}

function notSettled(
  reason: Extract<X402SettlementResponseVerification, { settled: false }>["reason"],
  receiptJson: string
): X402SettlementResponseVerification {
  return {
    settled: false,
    settlement_status: "not_settled",
    reason,
    receipt_json: receiptJson
  };
}

type RequirementCandidateInput = {
  candidate: Record<string, unknown>;
  index: number;
  policy: PolicyRecord;
  policyMax: string;
  expectedAmount: DecimalAmount | null;
  expectedAmountRaw: string | null;
  method: string;
  url: string;
};

function validateRequirementCandidate(
  input: RequirementCandidateInput
): X402RequirementCandidateRejectionReason | null {
  const amount = firstString(input.candidate, [
    "maxAmountRequired",
    "amount",
    "max_amount_required"
  ]);

  if (!amount) {
    return "amount_missing";
  }

  const comparisonContext = {
    policy: input.policy.allowed_asset,
    requirement: input.candidate
  };
  const candidateAmount = normalizePaymentAmountForComparison(amount, comparisonContext);
  if (!candidateAmount) {
    return "amount_invalid";
  }

  const expectedAmount = input.expectedAmountRaw
    ? normalizePaymentAmountForComparison(input.expectedAmountRaw, comparisonContext)
    : null;
  if (input.expectedAmount && !expectedAmount) {
    return "expected_amount_mismatch";
  }
  if (expectedAmount && compareDecimal(candidateAmount, expectedAmount) !== 0) {
    return "expected_amount_mismatch";
  }

  const policyMax = normalizePaymentAmountForComparison(input.policyMax, comparisonContext);
  if (!policyMax) {
    return "amount_over_limit";
  }
  if (!expectedAmount && compareDecimal(candidateAmount, policyMax) > 0) {
    return "amount_over_limit";
  }

  const resource = firstString(input.candidate, ["resource", "resourceUrl", "resource_url"]);
  if (!resource) {
    return "resource_missing";
  }

  if (resource !== input.url) {
    return "resource_mismatch";
  }

  const requirementMethod = firstString(input.candidate, ["method", "httpMethod", "http_method"]);
  if (!requirementMethod) {
    return "method_missing";
  }
  if (requirementMethod.toUpperCase() !== input.method) {
    return "method_mismatch";
  }

  const policySchemes = policyStrings(input.policy.allowed_asset, [
    "scheme",
    "schemes",
    "payment_scheme",
    "payment_schemes"
  ]);
  const requirementScheme = firstString(input.candidate, ["scheme"]);
  if (!requirementScheme) {
    return "scheme_missing";
  }
  if (policySchemes.length > 0 && !matchesAny(requirementScheme ?? "", policySchemes)) {
    return "scheme_mismatch";
  }

  const policyNetworks = policyStrings(input.policy.allowed_asset, [
    "network",
    "networkId",
    "network_id",
    "caip2_chain_id",
    "caip2ChainId",
    "chain_id",
    "chainId"
  ]);
  const requirementNetwork = firstString(input.candidate, [
    "network",
    "networkId",
    "network_id",
    "caip2_chain_id",
    "caip2ChainId"
  ]);
  if (!requirementNetwork) {
    return "network_missing";
  }
  if (
    policyNetworks.length > 0 &&
    !policyNetworks.some((policyNetwork) => networkMatches(requirementNetwork ?? "", policyNetwork))
  ) {
    return "network_mismatch";
  }

  const policyAssets = policyStrings(input.policy.allowed_asset, [
    "asset",
    "assetPackage",
    "asset_package",
    "assetPackageHash",
    "asset_package_hash",
    "token",
    "tokenAddress",
    "token_address"
  ]);
  const requirementAsset = firstString(input.candidate, ["asset", "assetPackage", "asset_package"]);
  if (!requirementAsset) {
    return "asset_missing";
  }
  if (policyAssets.length > 0 && !matchesAny(requirementAsset ?? "", policyAssets)) {
    return "asset_mismatch";
  }

  const policyPayees = policyStrings(input.policy.allowed_asset, [
    "payTo",
    "pay_to",
    "payee",
    "recipient",
    "recipientAddress",
    "recipient_address"
  ]);
  const requirementPayee = firstString(input.candidate, [
    "payTo",
    "pay_to",
    "payee",
    "recipient",
    "recipientAddress",
    "recipient_address"
  ]);
  if (!requirementPayee) {
    return "payee_missing";
  }
  if (policyPayees.length > 0 && !matchesAny(requirementPayee ?? "", policyPayees)) {
    return "payee_mismatch";
  }

  const timeout = firstValue(input.candidate, [
    "timeout",
    "timeoutSeconds",
    "timeout_seconds",
    "maxTimeoutSeconds",
    "max_timeout_seconds"
  ]);
  if (timeout === null) {
    return "timeout_missing";
  }
  if (!validTimeoutSeconds(timeout)) {
    return "timeout_invalid";
  }

  return null;
}

function rejected(reason: X402RequirementRejectionReason): X402RequirementApproval {
  return {
    approved: false,
    reason,
    rejected_candidates: []
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function firstValue(record: Record<string, unknown>, keys: string[]): unknown | null {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }

  return null;
}

function policyStrings(value: JsonObject, keys: string[]): string[] {
  const strings = new Set<string>();

  for (const key of keys) {
    const nested = value[key];
    if (typeof nested === "string" && nested.trim()) {
      strings.add(nested.trim());
    }

    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (typeof item === "string" && item.trim()) {
          strings.add(item.trim());
        }
      }
    }
  }

  return [...strings];
}

function matchesAny(value: string, accepted: string[]): boolean {
  const normalized = value.toLowerCase();
  return accepted.some((item) => item.toLowerCase() === normalized);
}

function validTimeoutSeconds(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0;
  }

  if (typeof value === "string") {
    return /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
  }

  return false;
}
