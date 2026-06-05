import { resolve } from "node:path";
import { createHash } from "node:crypto";

export type SigilConfig = {
  dataDir: string;
  grimoireMasterKey: Buffer;
  serverName: string;
  serverVersion: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SigilConfig {
  return {
    dataDir: resolve(env.SIGIL_DATA_DIR ?? ".sigil"),
    grimoireMasterKey: loadMasterKey(env.GRIMOIRE_MASTER_KEY),
    serverName: env.SIGIL_MCP_NAME ?? "sigil",
    serverVersion: env.SIGIL_MCP_VERSION ?? "0.1.0"
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
