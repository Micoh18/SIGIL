import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
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

export function runCliCommand(args: string[]): boolean {
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
    const result = initializeLocalSetup();
    process.stdout.write(formatInitResult(result));
    process.stdout.write(`\nPaste this into ${formatClientName(target)} MCP config:\n\n`);
    process.stdout.write(`${formatMcpConfig()}\n`);
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
