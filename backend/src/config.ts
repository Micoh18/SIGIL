import { createHash } from "node:crypto";
import { resolve } from "node:path";

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
  return {
    dataDir: resolve(env.SIGIL_DATA_DIR ?? ".sigil"),
    grimoireMasterKey: loadMasterKey(env.GRIMOIRE_MASTER_KEY),
    serverName: env.SIGIL_MCP_NAME ?? "sigil",
    serverVersion: env.SIGIL_MCP_VERSION ?? "0.1.0",
    casper: {
      networkName: env.CASPER_NETWORK_NAME ?? "casper-test",
      caip2ChainId: env.CASPER_CAIP2_CHAIN_ID ?? "casper:casper-test",
      rpcUrl: env.CASPER_RPC_URL ?? null,
      accountKeyPath: env.CASPER_ACCOUNT_KEY_PATH ?? null,
      memoryAnchorContractHash: env.MEMORY_ANCHOR_CONTRACT_HASH ?? null,
      memoryAnchorPackageHash: env.MEMORY_ANCHOR_PACKAGE_HASH ?? null
    },
    x402: {
      facilitatorUrl: env.X402_FACILITATOR_URL ?? "http://localhost:4022",
      resourceDemoUrl: env.X402_RESOURCE_DEMO_URL ?? "http://localhost:4021/weather",
      assetPackage: env.X402_ASSET_PACKAGE ?? null,
      assetName: env.X402_ASSET_NAME ?? null
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
