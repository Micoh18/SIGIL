import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configureTestnetWallet, formatMcpConfig } from "../src/cli.js";
import { loadLocalEnvFile } from "../src/env-file.js";

describe("CLI MCP config formatting", () => {
  it("prints JSON mcpServers by default", () => {
    const config = formatMcpConfig();

    expect(config).toContain('"mcpServers"');
    expect(config).toContain('"command": "npx"');
    expect(config).toContain('"mrmainspring"');
  });

  it("prints Codex TOML when requested", () => {
    const config = formatMcpConfig("codex");

    expect(config).toContain("[mcp_servers.mainspring]");
    expect(config).toContain('command = "npx"');
    expect(config).toContain('args = ["-y", "mrmainspring"]');
    expect(config).toContain("startup_timeout_sec = 20");
    expect(config).not.toContain("mcpServers");
  });

  it("configures a Casper testnet wallet without requiring manual env edits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mainspring-wallet-"));
    const envPath = join(dir, ".env");
    const keyPath = join(dir, "casper-test.pem");
    const { privateKey } = generateKeyPairSync("ed25519");
    await writeFile(
      keyPath,
      privateKey.export({ format: "pem", type: "pkcs8" }),
      "utf8"
    );
    await writeFile(
      envPath,
      ["# existing", "SIGIL_STORAGE_BACKEND=file", "CASPER_ENABLE_REAL_SUBMISSION=false", ""].join("\n"),
      "utf8"
    );

    const env = { SIGIL_ENV_FILE: envPath };
    const result = configureTestnetWallet(keyPath, env);
    const raw = await readFile(envPath, "utf8");

    expect(result.networkName).toBe("casper-test");
    expect(result.caip2ChainId).toBe("casper:casper-test");
    expect(result.keyAlgorithm).toBe("ed25519");
    expect(result.publicKey).toMatch(/^01[a-f0-9]{64}$/);
    expect(raw).toContain("SIGIL_STORAGE_BACKEND=file");
    expect(raw).toContain("CASPER_NETWORK_NAME=casper-test");
    expect(raw).toContain("CASPER_CAIP2_CHAIN_ID=casper:casper-test");
    expect(raw).toContain("CASPER_RPC_URL=https://node.testnet.casper.network/rpc");
    expect(raw).toContain("CASPER_ENABLE_REAL_SUBMISSION=true");
    expect(raw).toContain("X402_ENABLE_REAL_SETTLEMENT=true");
    expect(raw).toContain("X402_SETTLEMENT_MODE=casper-cli");
    const loadedEnv: NodeJS.ProcessEnv = { SIGIL_ENV_FILE: envPath };
    loadLocalEnvFile(loadedEnv);
    expect(loadedEnv.CASPER_ACCOUNT_KEY_PATH).toBe(keyPath);
    expect(loadedEnv.X402_BUYER_PRIVATE_KEY_PATH).toBe(keyPath);
  });
});
