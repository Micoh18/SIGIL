import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { discoverCasperClient } from "./casper/clientDiscovery.js";
import {
  agentIdentityPath,
  ensureLocalAgentIdentity,
  readLocalAgentIdentity
} from "./agent/identity.js";
import { loadConfig } from "./config.js";
import {
  detectClients,
  configureClients,
  setupAllClients,
  formatClientSetupReport,
  type ClientDetection
} from "./client-setup.js";
import {
  ensureGrimoireMasterKey,
  loadLocalEnvFile,
  resolveEnvPath,
  upsertLocalEnvFileValues
} from "./env-file.js";
import { getDefaultMainspringPaths } from "./paths.js";
import { loadCasperSigningKeyFromFile } from "./x402/signer.js";

const _pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION: string = JSON.parse(readFileSync(join(_pkgRoot, "package.json"), "utf8")).version;
const CASPER_TESTNET_MEMORY_ANCHOR_CONTRACT_HASH =
  "hash-9a10301e16f0871c57cf584810848d9eb859ba2c8c168fdf1cd7bdef99cb32df";
const CASPER_TESTNET_MEMORY_ANCHOR_PACKAGE_HASH =
  "hash-162da01355500a4ec1e715cfab6e5f3f12ee8cc57b3d23c444f377ad4014c98c";

const HELP = `Mr Mainspring MCP server

Usage:
  mainspring                  Start the MCP stdio server
  mainspring --help           Show this help
  mainspring --version        Show the installed version
  mainspring init             Create local config, data, and logs directories
  mainspring config [client]  Print MCP client config for codex/cursor/claude
  mainspring setup            Initialize local files and print MCP config
  mainspring wallet setup     Configure a Casper testnet wallet
  mainspring doctor           Check the local setup
  mainspring update           Show how to update to the latest version

MCP client config:
  {
    "mcpServers": {
      "mainspring": {
        "command": "npx",
        "args": ["-y", "mrmainspring"]
      }
    }
  }

Advanced users can still set SIGIL_ENV_FILE, SIGIL_DATA_DIR, Supabase, Casper,
and x402 env vars. No env vars are required for local memory, Grimoire, audit,
or payment preflight tools.
`;

const AGENT_DISCOVERY_HINT = [
  "For MCP agents:",
  "1) Call tool: mainspring.tools",
  "2) Cache the returned list of tools",
  "3) Use those exact names for all subsequent tool calls",
  ""
].join("\n");

type InitResult = {
  envFile: string;
  dataDir: string;
  logsDir: string;
  agentId: string;
  agentFile: string;
};

export type WalletSetupResult = {
  envFile: string;
  accountKeyPath: string;
  networkName: "casper-test";
  caip2ChainId: "casper:casper-test";
  rpcUrl: string;
  publicKey: string;
  keyAlgorithm: "ed25519" | "secp256k1";
  buyerAccountHash: string | null;
};

export async function runCliCommand(args: string[]): Promise<boolean> {
  const [command, target, ...rest] = args;

  if (!command || command === "stdio" || command === "server" || command === "mcp") {
    return false;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return true;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return true;
  }

  if (command === "init") {
    const result = initializeLocalSetup();
    process.stdout.write(formatInitResult(result));
    return true;
  }

  if (command === "config") {
    process.stdout.write(`${formatMcpConfig(target)}\n`);
    return true;
  }

  if (command === "setup") {
    if (process.stdin.isTTY) {
      await runInteractiveSetup();
    } else {
      const result = initializeLocalSetup();
      process.stdout.write(formatInitResult(result));
      const clientResults = setupAllClients();
      const report = formatClientSetupReport(clientResults);
      if (report) {
        process.stdout.write(report);
      } else {
        process.stdout.write(
          "\nNo MCP clients detected automatically.\n" +
          "Add this to your MCP client config (Claude Desktop, Cursor, Windsurf, Zed, VS Code, Continue, or any MCP host):\n\n"
        );
        process.stdout.write(`${formatMcpConfig()}\n`);
        process.stdout.write(
          "\nConfig file locations:\n" +
          "  Claude Desktop  ~/Library/Application Support/Claude/claude_desktop_config.json\n" +
          "  Cursor          ~/.cursor/mcp.json\n" +
          "  Windsurf        ~/.codeium/windsurf/mcp_config.json\n" +
          "  Zed             ~/.config/zed/settings.json  (context_servers format)\n" +
          "  VS Code         ~/.vscode/mcp.json\n\n"
        );
      }
      process.stdout.write(`${AGENT_DISCOVERY_HINT}\n`);
    }
    return true;
  }

  if (command === "wallet") {
    if (target !== "setup") {
      process.stderr.write(
        "Usage: mainspring wallet setup [path-to-casper-private-key.pem]\n"
      );
      process.exitCode = 1;
      return true;
    }

    await runWalletSetup(rest[0]);
    return true;
  }

  if (command === "doctor") {
    process.stdout.write(formatDoctorReport());
    return true;
  }

  if (command === "update") {
    process.stdout.write(
      "To update Mr Mainspring:\n\n" +
      "  npm install -g mrmainspring@latest\n\n" +
      "or if using npx (no install needed):\n\n" +
      "  npx mrmainspring@latest\n\n"
    );
    return true;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  process.exitCode = 1;
  return true;
}

async function runInteractiveSetup(): Promise<void> {
  clack.intro("Mr Mainspring — setup");

  const result = initializeLocalSetup();
  clack.log.success(
      `Local files ready\n` +
      `   Agent: ${result.agentId}\n` +
      `   Agent file: ${result.agentFile}\n` +
      `   Config: ${result.envFile}\n` +
      `   Data:   ${result.dataDir}`
  );

  const clients = detectClients();
  const installed = clients.filter(c => c.installed);
  const notInstalled = clients.filter(c => !c.installed);

  let selected: ClientDetection[];

  if (installed.length === 0) {
    clack.log.warn("No MCP clients detected on this machine.");
    clack.log.info(
      "Add this JSON to your client config manually:\n\n" +
      formatMcpConfig() + "\n\n" +
      "  Claude Desktop  ~/Library/Application Support/Claude/claude_desktop_config.json\n" +
      "  Cursor          ~/.cursor/mcp.json\n" +
      "  Windsurf        ~/.codeium/windsurf/mcp_config.json\n" +
      "  Zed             ~/.config/zed/settings.json\n" +
      "  VS Code         ~/.vscode/mcp.json"
    );
    clack.outro("Restart your client after updating the config.");
    return;
  }

  const choices = await clack.multiselect<ClientDetection>({
    message: "Which MCP clients should we configure?",
    options: [
      ...installed.map(c => ({
        value: c,
        label: c.name,
        hint: c.configPath,
        selected: true
      })),
      ...notInstalled.map(c => ({
        value: c,
        label: c.name,
        hint: "not found",
        selected: false
      }))
    ],
    required: false
  });

  if (clack.isCancel(choices)) {
    clack.cancel("Setup cancelled.");
    process.exitCode = 1;
    return;
  }

  selected = choices as ClientDetection[];

  if (selected.length === 0) {
    clack.log.warn("No clients selected — nothing configured.");
    clack.outro("Run mainspring setup again when ready.");
    return;
  }

  const configResults = configureClients(selected.filter(c => c.installed));
  const written = configResults.filter(r => r.status === "written").map(r => r.name);
  const alreadySet = configResults.filter(r => r.status === "already-set").map(r => r.name);
  const errors = configResults.filter(r => r.status === "error");

  if (written.length > 0) clack.log.success(`Configured: ${written.join(", ")}`);
  if (alreadySet.length > 0) clack.log.info(`Already configured: ${alreadySet.join(", ")}`);
  for (const e of errors) clack.log.error(`${e.name}: ${e.error}`);

  const wantCasper = await clack.confirm({
    message: "Enable Casper on-chain anchoring?",
    initialValue: false
  });

  if (clack.isCancel(wantCasper)) { clack.cancel("Setup cancelled."); return; }

  if (wantCasper) {
    clack.log.info(
      "Configure a funded Casper testnet key with:\n\n" +
      "  mainspring wallet setup <path-to-casper-testnet-key.pem>\n\n" +
      "This enables real Casper submission on casper-test."
    );
  }

  const wantX402 = await clack.confirm({
    message: "Enable x402 micropayments?",
    initialValue: false
  });

  if (clack.isCancel(wantX402)) { clack.cancel("Setup cancelled."); return; }

  if (wantX402) {
    clack.log.info(
      "Use the same testnet wallet command for local x402 settlement:\n\n" +
      "  mainspring wallet setup <path-to-casper-testnet-key.pem>\n\n" +
      "It writes X402_ENABLE_REAL_SETTLEMENT=true and X402_SETTLEMENT_MODE=casper-cli."
    );
  }

  clack.log.info(AGENT_DISCOVERY_HINT);
  clack.outro("Restart your MCP clients to load the server.");
}

async function runWalletSetup(keyPathArg: string | undefined): Promise<void> {
  let keyPath = keyPathArg;

  if (!keyPath && process.stdin.isTTY) {
    const response = await clack.text({
      message: "Path to your Casper testnet private key PEM",
      placeholder: "C:\\Users\\you\\keys\\casper-test.pem",
      validate(value) {
        return value?.trim() ? undefined : "A PEM key path is required.";
      }
    });

    if (clack.isCancel(response)) {
      clack.cancel("Wallet setup cancelled.");
      process.exitCode = 1;
      return;
    }

    keyPath = response;
  }

  if (!keyPath?.trim()) {
    process.stderr.write(
      "Usage: mainspring wallet setup [path-to-casper-private-key.pem]\n"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = configureTestnetWallet(keyPath);
    process.stdout.write(formatWalletSetupResult(result));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export function configureTestnetWallet(
  keyPath: string,
  env: NodeJS.ProcessEnv = process.env
): WalletSetupResult {
  const setup = initializeLocalSetup(env);
  const walletEnv = { ...env, SIGIL_ENV_FILE: setup.envFile };
  loadLocalEnvFile(walletEnv);
  const normalizedKeyPath = normalizeUserPath(keyPath);
  if (!existsSync(normalizedKeyPath)) {
    throw new Error(`Casper key file not found: ${normalizedKeyPath}`);
  }

  const stat = statSync(normalizedKeyPath);
  if (!stat.isFile()) {
    throw new Error(`Casper key path must be a file: ${normalizedKeyPath}`);
  }

  const signingKey = loadCasperSigningKeyFromFile(normalizedKeyPath);
  const buyerAccountHash =
    signingKey.algorithm === "secp256k1"
      ? deriveCasperAccountHash(signingKey.publicKey, walletEnv)
      : null;

  const values: Record<string, string> = {
    CASPER_NETWORK_NAME: "casper-test",
    CASPER_CAIP2_CHAIN_ID: "casper:casper-test",
    CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
    CASPER_ACCOUNT_KEY_PATH: normalizedKeyPath,
    CASPER_ENABLE_REAL_SUBMISSION: "true",
    MEMORY_ANCHOR_CONTRACT_HASH: CASPER_TESTNET_MEMORY_ANCHOR_CONTRACT_HASH,
    MEMORY_ANCHOR_PACKAGE_HASH: CASPER_TESTNET_MEMORY_ANCHOR_PACKAGE_HASH,
    X402_ENABLE_REAL_SETTLEMENT: "true",
    X402_SETTLEMENT_MODE: "casper-cli",
    X402_BUYER_PRIVATE_KEY_PATH: normalizedKeyPath,
    X402_BUYER_PUBLIC_KEY: signingKey.publicKey
  };

  if (buyerAccountHash) {
    values.X402_BUYER_ACCOUNT_HASH = buyerAccountHash;
  }

  const envFile = upsertLocalEnvFileValues(values, walletEnv);
  return {
    envFile,
    accountKeyPath: normalizedKeyPath,
    networkName: "casper-test",
    caip2ChainId: "casper:casper-test",
    rpcUrl: values.CASPER_RPC_URL,
    publicKey: signingKey.publicKey,
    keyAlgorithm: signingKey.algorithm,
    buyerAccountHash
  };
}

export function initializeLocalSetup(env: NodeJS.ProcessEnv = process.env): InitResult {
  const paths = getDefaultMainspringPaths(env);
  const envFile = env.SIGIL_ENV_FILE?.trim() ? resolveEnvPath(env) : paths.envFile;

  mkdirSync(paths.appDir, { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(dirname(envFile), { recursive: true });

  if (!existsSync(envFile)) {
    writeFileSync(
      envFile,
      [
        "# Mr Mainspring local config",
        "SIGIL_STORAGE_BACKEND=file",
        `SIGIL_DATA_DIR=${quoteEnvValue(paths.dataDir)}`,
        ""
      ].join("\n"),
      "utf8"
    );
  }

  const setupEnv = { ...env, SIGIL_ENV_FILE: envFile };
  loadLocalEnvFile(setupEnv);
  ensureGrimoireMasterKey(setupEnv, { announce: false });
  const agentIdentity = ensureLocalAgentIdentity(paths.dataDir);

  return {
    envFile,
    dataDir: paths.dataDir,
    logsDir: paths.logsDir,
    agentId: agentIdentity.agent_id,
    agentFile: agentIdentityPath(paths.dataDir)
  };
}

function formatWalletSetupResult(result: WalletSetupResult): string {
  const lines = [
    "Mr Mainspring Casper testnet wallet configured.",
    `Config: ${result.envFile}`,
    `Network: ${result.networkName}`,
    `RPC: ${result.rpcUrl}`,
    `Key: ${result.accountKeyPath}`,
    `Public key: ${result.publicKey}`,
    "Casper real submission: enabled",
    "x402 real settlement: enabled"
  ];

  if (result.buyerAccountHash) {
    lines.push(`x402 buyer account hash: ${result.buyerAccountHash}`);
  } else if (result.keyAlgorithm === "secp256k1") {
    lines.push(
      "Warning: secp256k1 key detected, but X402_BUYER_ACCOUNT_HASH could not be derived automatically."
    );
    lines.push("Run: casper-client account-address --public-key <public-key>");
  }

  lines.push("", "Run `mainspring doctor` to verify the setup.", "");
  return lines.join("\n");
}

export function formatMcpConfig(target?: string): string {
  if (normalizeMcpClientTarget(target) === "codex") {
    return [
      "[mcp_servers.mainspring]",
      'command = "npx"',
      'args = ["-y", "mrmainspring"]',
      "startup_timeout_sec = 20",
      "tool_timeout_sec = 60",
      "enabled = true"
    ].join("\n");
  }

  return JSON.stringify(
    {
      mcpServers: {
        mainspring: {
          command: "npx",
          args: ["-y", "mrmainspring"]
        }
      }
    },
    null,
    2
  );
}

function formatInitResult(result: InitResult): string {
  return [
    "Mr Mainspring local setup is ready.",
    `Agent: ${result.agentId}`,
    `Agent file: ${result.agentFile}`,
    `Config: ${result.envFile}`,
    `Data:   ${result.dataDir}`,
    `Logs:   ${result.logsDir}`,
    ""
  ].join("\n");
}

function formatDoctorReport(env: NodeJS.ProcessEnv = process.env): string {
  const paths = getDefaultMainspringPaths(env);
  const envFile = resolveEnvPath(env);
  const envCopy = { ...env };
  loadLocalEnvFile(envCopy);

  const lines = ["Mr Mainspring doctor"];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  lines.push(formatCheck(nodeMajor >= 20, `Node.js ${process.versions.node}`, "Node.js 20 or newer is required"));
  lines.push(formatCheck(existsSync(envFile), `Config file: ${envFile}`, "Config file missing; run mainspring init"));
  lines.push(formatCheck(existsSync(paths.dataDir), `Data dir: ${paths.dataDir}`, "Data dir missing; run mainspring init"));
  lines.push(formatCheck(existsSync(paths.logsDir), `Logs dir: ${paths.logsDir}`, "Logs dir missing; run mainspring init"));
  const identity = readLocalAgentIdentity(paths.dataDir);
  lines.push(
    formatCheck(
      Boolean(identity),
      `Agent identity: ${identity?.agent_id}`,
      "Agent identity missing; run mainspring init"
    )
  );

  const casperProbe = discoverCasperClient({
    clientBin: envCopy.CASPER_CLIENT_BIN,
    clientWslDistro: envCopy.CASPER_CLIENT_WSL_DISTRO
  });
  lines.push(formatCheck(
    casperProbe.found,
    casperProbe.success,
    casperProbe.failure
  ));

  try {
    const config = loadConfig(envCopy);
    lines.push(`[ok] Storage backend: ${config.storage.backend}`);
    lines.push(`[ok] Casper real submission: ${config.casper.submissionEnabled ? "enabled" : "disabled"}`);
    lines.push(formatCheck(
      Boolean(config.casper.memoryAnchorContractHash),
      `Casper memory anchor contract: ${config.casper.memoryAnchorContractHash}`,
      "Casper memory anchor contract not configured; run mainspring wallet setup <path-to-casper-private-key.pem>"
    ));
    lines.push(`[ok] x402 real settlement: ${config.x402.settlementEnabled ? "enabled" : "disabled"}`);
  } catch (error) {
    lines.push(`[error] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }

  return `${lines.join("\n")}\n`;
}

function formatCheck(ok: boolean, success: string, failure: string): string {
  return ok ? `[ok] ${success}` : `[warn] ${failure}`;
}

function normalizeUserPath(value: string): string {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  return resolve(trimmed);
}

function deriveCasperAccountHash(
  publicKey: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const casperClient = discoverCasperClient({
    clientBin: env.CASPER_CLIENT_BIN,
    clientWslDistro: env.CASPER_CLIENT_WSL_DISTRO
  });

  if (!casperClient.found) {
    return null;
  }

  const invocation = casperClient.clientWslDistro
    ? {
        command: "wsl",
        args: [
          "-d",
          casperClient.clientWslDistro,
          "--",
          casperClient.clientBin,
          "account-address",
          "--public-key",
          publicKey
        ]
      }
    : {
        command: casperClient.clientBin,
        args: ["account-address", "--public-key", publicKey]
      };

  const result = spawnSync(invocation.command, invocation.args, {
    stdio: "pipe",
    encoding: "utf8"
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/(?:account-hash-)?([a-f0-9]{64})/i);
  return match?.[1] ? `account-hash-${match[1].toLowerCase()}` : null;
}

function normalizeMcpClientTarget(target: string | undefined): "codex" | "cursor" | "claude" | "generic" {
  const normalized = target?.trim().toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "cursor") return "cursor";
  if (normalized === "claude" || normalized === "claude-desktop" || normalized === "claude_desktop") return "claude";
  return "generic";
}

function quoteEnvValue(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}
