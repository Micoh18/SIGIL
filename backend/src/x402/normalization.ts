import type { JsonObject } from "../memory/types.js";

export type DecimalAmount = {
  value: bigint;
  scale: number;
};

export function parseDecimalAmount(value: string): DecimalAmount | null {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return null;
  }

  const [whole, fraction = ""] = value.split(".");
  return {
    value: BigInt(`${whole}${fraction}`),
    scale: fraction.length
  };
}

export function compareDecimal(leftParts: DecimalAmount, rightParts: DecimalAmount): number {
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
}

export function addDecimalParts(leftParts: DecimalAmount, rightParts: DecimalAmount): DecimalAmount {
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);

  return {
    value: leftValue + rightValue,
    scale
  };
}

export function normalizeCasperNetwork(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "casper-test" ||
    normalized === "testnet" ||
    normalized === "casper:testnet" ||
    normalized === "casper:casper-test"
  ) {
    return "casper:casper-test";
  }

  if (
    normalized === "casper" ||
    normalized === "mainnet" ||
    normalized === "casper:mainnet" ||
    normalized === "casper:casper"
  ) {
    return "casper:casper";
  }

  return normalized;
}

export function networkMatches(left: string, right: string): boolean {
  return normalizeCasperNetwork(left) === normalizeCasperNetwork(right);
}

export function normalizePaymentAmountForComparison(
  value: string,
  context: { policy?: JsonObject; requirement?: Record<string, unknown> }
): DecimalAmount | null {
  const parsed = parseDecimalAmount(value);
  if (!parsed) {
    return null;
  }

  if (!isCasperNativeContext(context)) {
    return parsed;
  }

  return value.includes(".") || parsed.value < 1_000_000_000n ? csprToMotes(parsed) : parsed;
}

export function isCasperNativeContext(context: {
  policy?: JsonObject;
  requirement?: Record<string, unknown>;
}): boolean {
  const values = [
    ...stringsFromRecord(context.policy, [
      "asset",
      "assetId",
      "asset_id",
      "allowed_asset",
      "token"
    ]),
    ...stringsFromRecord(context.requirement, ["asset", "assetId", "asset_id"])
  ];

  if (values.some((value) => isCasperNativeAsset(value))) {
    return true;
  }

  const networks = [
    ...stringsFromRecord(context.policy, [
      "network",
      "networkId",
      "network_id",
      "caip2_chain_id",
      "caip2ChainId",
      "chain_id",
      "chainId"
    ]),
    ...stringsFromRecord(context.requirement, [
      "network",
      "networkId",
      "network_id",
      "caip2_chain_id",
      "caip2ChainId"
    ])
  ];

  return networks.some((value) => normalizeCasperNetwork(value).startsWith("casper:"));
}

function csprToMotes(amount: DecimalAmount): DecimalAmount {
  return {
    value: amount.value * 10n ** BigInt(Math.max(0, 9 - amount.scale)),
    scale: Math.max(0, amount.scale - 9)
  };
}

function isCasperNativeAsset(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "casper-native-cspr" || normalized === "cspr";
}

function stringsFromRecord(
  record: Record<string, unknown> | JsonObject | null | undefined,
  keys: string[]
): string[] {
  if (!record) {
    return [];
  }

  const strings: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      strings.push(value.trim());
    }
  }

  return strings;
}
