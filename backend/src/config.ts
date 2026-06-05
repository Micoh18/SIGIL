import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CASPER_HASH_PATTERN = /^(hash-)?[a-f0-9]{64}$/i;
const CASPER_PACKAGE_HASH_PATTERN = /^(hash-|package-)?[a-f0-9]{64}$/i;

export type CasperConfig = {
  networkName: string;
  caip2ChainId: string;
  rpcUrl: string | null;
  accountKeyPath: string | null;
  memoryAnchorContractHash: string | null;
  memoryAnchorPackageHash: string | null;
  submissionEnabled: boolean;
  clientBin: string;
  clientWslDistro: string | null;
  anchorSubmissionMode: "transaction-package" | "deploy-contract-hash";
  gasPriceTolerance: string;
  pricingMode: string;
  anchorPaymentAmountMotes: string;
};

export type X402Config = {
  facilitatorUrl: string;
  resourceDemoUrl: string;
  assetPackage: string | null;
  assetName: string | null;
  settlementEnabled: boolean;
};

export type StorageConfig =
  | {
      backend: "file";
    }
  | {
      backend: "supabase";
      supabase: {
        url: string;
        key: string;
        schema: string;
        tablePrefix: string;
      };
    };

export type SigilConfig = {
  dataDir: string;
  grimoireMasterKey: Buffer;
  serverName: string;
  serverVersion: string;
  storage: StorageConfig;
  casper: CasperConfig;
  x402: X402Config;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SigilConfig {
  const casper = {
    networkName: optionalEnv(env.CASPER_NETWORK_NAME) ?? "casper-test",
    caip2ChainId: optionalEnv(env.CASPER_CAIP2_CHAIN_ID) ?? "casper:casper-test",
    rpcUrl: optionalEnv(env.CASPER_RPC_URL),
    accountKeyPath: normalizeCasperAccountKeyPath(
      optionalEnv(env.CASPER_ACCOUNT_KEY_PATH) ?? "./keys/backend.pem",
      optionalEnv(env.CASPER_CLIENT_WSL_DISTRO)
    ),
    memoryAnchorContractHash: optionalEnv(env.MEMORY_ANCHOR_CONTRACT_HASH),
    memoryAnchorPackageHash: optionalEnv(env.MEMORY_ANCHOR_PACKAGE_HASH),
    submissionEnabled: parseBoolean(env.CASPER_ENABLE_REAL_SUBMISSION),
    clientBin: optionalEnv(env.CASPER_CLIENT_BIN) ?? "casper-client",
    clientWslDistro: optionalEnv(env.CASPER_CLIENT_WSL_DISTRO),
    anchorSubmissionMode: parseCasperAnchorSubmissionMode(
      env.CASPER_ANCHOR_SUBMISSION_MODE
    ),
    gasPriceTolerance: optionalEnv(env.CASPER_GAS_PRICE_TOLERANCE) ?? "10",
    pricingMode: optionalEnv(env.CASPER_PRICING_MODE) ?? "classic",
    anchorPaymentAmountMotes:
      optionalEnv(env.CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES) ?? "3000000000"
  };

  validateCasperConfig(casper);

  return {
    dataDir: resolve(optionalEnv(env.SIGIL_DATA_DIR) ?? ".sigil"),
    grimoireMasterKey: loadMasterKey(env.GRIMOIRE_MASTER_KEY),
    serverName: optionalEnv(env.SIGIL_MCP_NAME) ?? "mr-mainspring",
    serverVersion: optionalEnv(env.SIGIL_MCP_VERSION) ?? "0.1.0",
    storage: loadStorageConfig(env),
    casper,
    x402: {
      facilitatorUrl: optionalEnv(env.X402_FACILITATOR_URL) ?? "http://localhost:4022",
      resourceDemoUrl: optionalEnv(env.X402_RESOURCE_DEMO_URL) ?? "http://localhost:4021/weather",
      assetPackage: optionalEnv(env.X402_ASSET_PACKAGE),
      assetName: optionalEnv(env.X402_ASSET_NAME),
      settlementEnabled: parseBoolean(env.X402_ENABLE_REAL_SETTLEMENT)
    }
  };
}

function loadStorageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  const backend = optionalEnv(env.SIGIL_STORAGE_BACKEND);
  const supabaseUrl = optionalEnv(env.PROJECT_URL) ?? optionalEnv(env.SUPABASE_URL);
  const supabaseKey =
    optionalEnv(env.SECRET_KEY) ??
    optionalEnv(env.PUBLISHABLE_KEY) ??
    optionalEnv(env.SUPABASE_SERVICE_ROLE_KEY) ??
    optionalEnv(env.SUPABASE_ANON_KEY);

  if (!backend && !supabaseUrl && !supabaseKey) {
    return { backend: "file" };
  }

  if (backend && backend !== "file" && backend !== "supabase") {
    throw new Error("SIGIL_STORAGE_BACKEND must be either file or supabase");
  }

  if (backend === "file") {
    return { backend: "file" };
  }

  if (!supabaseUrl) {
    throw new Error("PROJECT_URL is required when Supabase storage is enabled");
  }

  if (!supabaseKey) {
    throw new Error(
      "SECRET_KEY or PUBLISHABLE_KEY is required when Supabase storage is enabled"
    );
  }

  assertHttpUrl("PROJECT_URL", supabaseUrl);

  return {
    backend: "supabase",
    supabase: {
      url: supabaseUrl,
      key: supabaseKey,
      schema: optionalEnv(env.SUPABASE_DB_SCHEMA) ?? "public",
      tablePrefix: optionalEnv(env.SUPABASE_TABLE_PREFIX) ?? "sigil_"
    }
  };
}

function loadMasterKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) {
    return createHash("sha256").update("sigil-local-development-master-key").digest();
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.byteLength !== 32) {
    throw new Error("GRIMOIRE_MASTER_KEY must be a base64-encoded 32-byte key");
  }

  return key;
}

function validateCasperConfig(config: CasperConfig): void {
  assertNonEmpty("CASPER_NETWORK_NAME", config.networkName);
  assertNonEmpty("CASPER_CAIP2_CHAIN_ID", config.caip2ChainId);

  if (config.memoryAnchorContractHash) {
    assertCasperHash("MEMORY_ANCHOR_CONTRACT_HASH", config.memoryAnchorContractHash);

    if (!config.memoryAnchorPackageHash) {
      throw new Error(
        "MEMORY_ANCHOR_PACKAGE_HASH is required when MEMORY_ANCHOR_CONTRACT_HASH is set"
      );
    }

    if (!config.rpcUrl) {
      throw new Error("CASPER_RPC_URL is required when MEMORY_ANCHOR_CONTRACT_HASH is set");
    }

    if (!config.accountKeyPath) {
      throw new Error(
        "CASPER_ACCOUNT_KEY_PATH is required when MEMORY_ANCHOR_CONTRACT_HASH is set"
      );
    }
  }

  if (config.memoryAnchorPackageHash) {
    assertCasperPackageHash("MEMORY_ANCHOR_PACKAGE_HASH", config.memoryAnchorPackageHash);
  }

  if (config.rpcUrl) {
    assertHttpUrl("CASPER_RPC_URL", config.rpcUrl);
  }

  assertNonEmpty("CASPER_CLIENT_BIN", config.clientBin);
  if (config.clientWslDistro) {
    assertNonEmpty("CASPER_CLIENT_WSL_DISTRO", config.clientWslDistro);
  }
  assertUnsignedInteger("CASPER_GAS_PRICE_TOLERANCE", config.gasPriceTolerance);
  assertPricingMode("CASPER_PRICING_MODE", config.pricingMode);
  assertUnsignedInteger(
    "CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES",
    config.anchorPaymentAmountMotes
  );
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
}

function assertCasperHash(name: string, value: string): void {
  if (!CASPER_HASH_PATTERN.test(value)) {
    throw new Error(`${name} must be a Casper hash value with optional hash- prefix`);
  }
}

function assertCasperPackageHash(name: string, value: string): void {
  if (!CASPER_PACKAGE_HASH_PATTERN.test(value)) {
    throw new Error(`${name} must be a Casper package hash value`);
  }
}

function assertHttpUrl(name: string, value: string): void {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an HTTP(S) URL`);
  }
}

function assertUnsignedInteger(name: string, value: string): void {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer`);
  }
}

function assertPricingMode(name: string, value: string): void {
  if (value !== "classic" && value !== "reserved" && value !== "fixed") {
    throw new Error(`${name} must be classic, reserved, or fixed`);
  }
}

function parseBoolean(value: string | undefined): boolean {
  const normalized = optionalEnv(value)?.toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseCasperAnchorSubmissionMode(
  value: string | undefined
): CasperConfig["anchorSubmissionMode"] {
  const normalized = optionalEnv(value) ?? "transaction-package";

  if (normalized === "transaction-package" || normalized === "deploy-contract-hash") {
    return normalized;
  }

  throw new Error(
    "CASPER_ANCHOR_SUBMISSION_MODE must be transaction-package or deploy-contract-hash"
  );
}

function normalizeCasperAccountKeyPath(value: string, clientWslDistro: string | null): string {
  if (!clientWslDistro) {
    return value;
  }

  if (value.startsWith("/")) {
    return value;
  }

  const absolutePath = isAbsolute(value) ? value : resolve(repoRoot(), value);

  return toWslPath(absolutePath);
}

function repoRoot(): string {
  const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));

  return dirname(backendRoot);
}

function toWslPath(value: string): string {
  const match = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) {
    return value.replaceAll("\\", "/");
  }

  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}`;
}

function optionalEnv(value: string | undefined): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}
