import { createHash } from "node:crypto";
import { resolve } from "node:path";

const CASPER_HASH_PATTERN = /^(hash-)?[a-f0-9]{64}$/i;

export type CasperConfig = {
  networkName: string;
  caip2ChainId: string;
  rpcUrl: string | null;
  accountKeyPath: string | null;
  memoryAnchorContractHash: string | null;
  memoryAnchorPackageHash: string | null;
};

export type X402Config = {
  facilitatorUrl: string;
  resourceDemoUrl: string;
  assetPackage: string | null;
  assetName: string | null;
};

export type SigilConfig = {
  dataDir: string;
  grimoireMasterKey: Buffer;
  serverName: string;
  serverVersion: string;
  casper: CasperConfig;
  x402: X402Config;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SigilConfig {
  const casper = {
    networkName: optionalEnv(env.CASPER_NETWORK_NAME) ?? "casper-test",
    caip2ChainId: optionalEnv(env.CASPER_CAIP2_CHAIN_ID) ?? "casper:casper-test",
    rpcUrl: optionalEnv(env.CASPER_RPC_URL),
    accountKeyPath: optionalEnv(env.CASPER_ACCOUNT_KEY_PATH) ?? "./keys/backend.pem",
    memoryAnchorContractHash: optionalEnv(env.MEMORY_ANCHOR_CONTRACT_HASH),
    memoryAnchorPackageHash: optionalEnv(env.MEMORY_ANCHOR_PACKAGE_HASH)
  };

  validateCasperConfig(casper);

  return {
    dataDir: resolve(optionalEnv(env.SIGIL_DATA_DIR) ?? ".sigil"),
    grimoireMasterKey: loadMasterKey(env.GRIMOIRE_MASTER_KEY),
    serverName: optionalEnv(env.SIGIL_MCP_NAME) ?? "mr-mainspring",
    serverVersion: optionalEnv(env.SIGIL_MCP_VERSION) ?? "0.1.0",
    casper,
    x402: {
      facilitatorUrl: optionalEnv(env.X402_FACILITATOR_URL) ?? "http://localhost:4022",
      resourceDemoUrl: optionalEnv(env.X402_RESOURCE_DEMO_URL) ?? "http://localhost:4021/weather",
      assetPackage: optionalEnv(env.X402_ASSET_PACKAGE),
      assetName: optionalEnv(env.X402_ASSET_NAME)
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
    assertCasperHash("MEMORY_ANCHOR_PACKAGE_HASH", config.memoryAnchorPackageHash);
  }

  if (config.rpcUrl) {
    assertHttpUrl("CASPER_RPC_URL", config.rpcUrl);
  }
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

function assertHttpUrl(name: string, value: string): void {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an HTTP(S) URL`);
  }
}

function optionalEnv(value: string | undefined): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}
