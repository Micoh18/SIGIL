import { canonicalizeJson, toJsonObject } from "../memory/canonical.js";
import { sha256Hex } from "../memory/hash.js";
import type { JsonObject } from "../memory/types.js";
import type { PolicyRecord } from "../grimoire/types.js";

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
  | "method_mismatch"
  | "network_missing"
  | "network_mismatch"
  | "asset_missing"
  | "asset_mismatch"
  | "payee_missing"
  | "payee_mismatch"
  | "scheme_missing"
  | "scheme_mismatch";

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
        | "settlement_transaction_hash_missing";
      receipt_json: string | null;
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

  const policyMax = parseDecimalAmount(input.policy.max_amount_per_call);
  if (!policyMax) {
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
      policyMax,
      expectedAmount,
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

export function verifyX402SettlementResponse(
  settlementResponse: unknown
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

  const receipt = toJsonObject(response, "settlement_response");
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

  return {
    settled: true,
    settlement_status: "settled",
    transaction_hash: transactionHash,
    receipt_json: receiptJson
  };
}

type RequirementCandidateInput = {
  candidate: Record<string, unknown>;
  index: number;
  policy: PolicyRecord;
  policyMax: DecimalAmount;
  expectedAmount: DecimalAmount | null;
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

  const candidateAmount = parseDecimalAmount(amount);
  if (!candidateAmount) {
    return "amount_invalid";
  }

  if (input.expectedAmount && compareDecimal(candidateAmount, input.expectedAmount) !== 0) {
    return "expected_amount_mismatch";
  }

  if (!input.expectedAmount && compareDecimal(candidateAmount, input.policyMax) > 0) {
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
  if (requirementMethod && requirementMethod.toUpperCase() !== input.method) {
    return "method_mismatch";
  }

  const policySchemes = policyStrings(input.policy.allowed_asset, [
    "scheme",
    "schemes",
    "payment_scheme",
    "payment_schemes"
  ]);
  const requirementScheme = firstString(input.candidate, ["scheme"]);
  if (policySchemes.length > 0 && !requirementScheme) {
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
  if (policyNetworks.length > 0 && !requirementNetwork) {
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
  if (policyAssets.length > 0 && !requirementAsset) {
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
  if (policyPayees.length > 0 && !requirementPayee) {
    return "payee_missing";
  }
  if (policyPayees.length > 0 && !matchesAny(requirementPayee ?? "", policyPayees)) {
    return "payee_mismatch";
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

function networkMatches(requirementNetwork: string, policyNetwork: string): boolean {
  const requirement = requirementNetwork.toLowerCase();
  const policy = policyNetwork.toLowerCase();

  if (requirement === policy) {
    return true;
  }

  const requirementSuffix = requirement.split(":").at(-1);
  const policySuffix = policy.split(":").at(-1);
  return Boolean(requirementSuffix && policySuffix && requirementSuffix === policySuffix);
}

type DecimalAmount = {
  value: bigint;
  scale: number;
};

function compareDecimal(leftParts: DecimalAmount, rightParts: DecimalAmount): number {
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
}

function parseDecimalAmount(value: string): DecimalAmount | null {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return null;
  }

  const [whole, fraction = ""] = value.split(".");
  return {
    value: BigInt(`${whole}${fraction}`),
    scale: fraction.length
  };
}
