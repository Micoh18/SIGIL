import { resolve } from "node:path";

export type SigilConfig = {
  dataDir: string;
  serverName: string;
  serverVersion: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SigilConfig {
  return {
    dataDir: resolve(env.SIGIL_DATA_DIR ?? ".sigil"),
    serverName: env.SIGIL_MCP_NAME ?? "sigil",
    serverVersion: env.SIGIL_MCP_VERSION ?? "0.1.0"
  };
}

