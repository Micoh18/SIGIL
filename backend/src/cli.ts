import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { loadConfig } from "./config.js";
import {
  detectClients,
  configureClients,
  setupAllClients,
  formatClientSetupReport,
  type ClientDetection
} from "./client-setup.js";
import { ensureGrimoireMasterKey, loadLocalEnvFile, resolveEnvPath } from "./env-file.js";
import { getDefaultMainspringPaths } from "./paths.js";

const _pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION: string = JSON.parse(readFileSync(join(_pkgRoot, "package.json"), "utf8")).version;

const HELP = `Mr Mainspring MCP server

Usage:
  mainspring                  Start the MCP stdio server
  mainspring --help           Show this help
  mainspring --version        Show the installed version
  mainspring init             Create local config, data, and logs directories
  mainspring config           Print MCP client config JSON
  mainspring setup            Initialize local files and print MCP config
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

type InitResult = {
  envFile: string;
  dataDir: string;
  logsDir: string;
};

export async function runCliCommand(args: string[]): Promise<boolean> {
  const [command, target] = args;

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
    process.stdout.write(`${formatMcpConfig()}\n`);
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
    }
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
  clack.log.success(`Local files ready\n   Config: ${result.envFile}\n   Data:   ${result.dataDir}`);

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
      "Add to your .env file:\n\n" +
      "  CASPER_ENABLE_REAL_SUBMISSION=true\n" +
      "  CASPER_RPC_URL=https://node.testnet.casper.network/rpc\n" +
      "  CASPER_ACCOUNT_KEY_PATH=./keys/your-key.pem\n\n" +
      "Then restart your MCP client."
    );
  }

  const wantX402 = await clack.confirm({
    message: "Enable x402 micropayments?",
    initialValue: false
  });

  if (clack.isCancel(wantX402)) { clack.cancel("Setup cancelled."); return; }

  if (wantX402) {
    clack.log.info(
      "Add to your .env file:\n\n" +
      "  X402_ENABLE_REAL_SETTLEMENT=true\n" +
      "  X402_SETTLEMENT_MODE=casper-cli\n" +
      "  X402_BUYER_ACCOUNT_HASH=account-hash-<64 hex chars>\n" +
      "  CASPER_ENABLE_REAL_SUBMISSION=true\n\n" +
      "Get your account hash: casper-client account-address --public-key <your-pubkey-hex>"
    );
  }

  clack.outro("Restart your MCP clients to load the server.");
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

  return {
    envFile,
    dataDir: paths.dataDir,
    logsDir: paths.logsDir
  };
}

export function formatMcpConfig(): string {
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

  const casperBin = envCopy.CASPER_CLIENT_BIN ?? "casper-client";
  const casperProbe = spawnSync(casperBin, ["--version"], { stdio: "pipe" });
  lines.push(formatCheck(
    !casperProbe.error,
    `casper-client: ${casperBin}`,
    `casper-client not found at "${casperBin}" — optional, needed for on-chain anchoring (cargo install casper-client)`
  ));

  try {
    const config = loadConfig(envCopy);
    lines.push(`[ok] Storage backend: ${config.storage.backend}`);
    lines.push(`[ok] Casper real submission: ${config.casper.submissionEnabled ? "enabled" : "disabled"}`);
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

function formatClientName(target: string | undefined): string {
  if (!target) return "your";
  if (target.toLowerCase() === "cursor") return "Cursor";
  if (target.toLowerCase() === "claude") return "Claude Desktop";
  return target;
}

function quoteEnvValue(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}
