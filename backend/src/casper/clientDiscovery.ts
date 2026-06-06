import { spawnSync } from "node:child_process";

type SpawnSyncRunner = typeof spawnSync;
const discoveryCache = new Map<string, CasperClientDiscovery>();

export type CasperClientDiscovery = {
  clientBin: string;
  clientWslDistro: string | null;
  found: boolean;
  success: string;
  failure: string;
};

export type CasperClientDiscoveryOptions = {
  clientBin?: string | null;
  clientWslDistro?: string | null;
  autoDetectWsl?: boolean;
  platform?: NodeJS.Platform;
  spawn?: SpawnSyncRunner;
};

export function discoverCasperClient(
  options: CasperClientDiscoveryOptions = {}
): CasperClientDiscovery {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? spawnSync;
  const requestedClientBin = normalizeOptional(options.clientBin) ?? "casper-client";
  const requestedWslDistro =
    platform === "win32" ? normalizeOptional(options.clientWslDistro) : null;
  const autoDetectWsl = options.autoDetectWsl ?? true;
  const cacheKey = `${platform}\0${requestedClientBin}\0${requestedWslDistro ?? ""}\0${autoDetectWsl}`;

  if (!options.spawn) {
    const cached = discoveryCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const discovered = discoverCasperClientUncached(
    platform,
    spawn,
    requestedClientBin,
    requestedWslDistro,
    autoDetectWsl
  );

  if (!options.spawn) {
    discoveryCache.set(cacheKey, discovered);
  }

  return discovered;
}

function discoverCasperClientUncached(
  platform: NodeJS.Platform,
  spawn: SpawnSyncRunner,
  requestedClientBin: string,
  requestedWslDistro: string | null,
  autoDetectWsl: boolean
): CasperClientDiscovery {
  if (requestedWslDistro) {
    return discoverWslCasperClient(spawn, requestedWslDistro, requestedClientBin, true);
  }

  const nativeProbe = spawn(requestedClientBin, ["--version"], { stdio: "pipe" });
  if (probeSucceeded(nativeProbe)) {
    return {
      clientBin: requestedClientBin,
      clientWslDistro: null,
      found: true,
      success: `casper-client: ${requestedClientBin}`,
      failure: `casper-client not found at "${requestedClientBin}" — optional, needed for on-chain anchoring (cargo install casper-client)`
    };
  }

  if (platform !== "win32" || !autoDetectWsl) {
    return {
      clientBin: requestedClientBin,
      clientWslDistro: null,
      found: false,
      success: `casper-client: ${requestedClientBin}`,
      failure: `casper-client not found at "${requestedClientBin}" — optional, needed for on-chain anchoring (cargo install casper-client)`
    };
  }

  for (const distro of listWslDistros(spawn)) {
    const discovered = discoverWslCasperClient(spawn, distro, requestedClientBin, false);
    if (discovered.found) {
      return discovered;
    }
  }

  return {
    clientBin: requestedClientBin,
    clientWslDistro: null,
    found: false,
    success: `casper-client: ${requestedClientBin}`,
    failure: `casper-client not found at "${requestedClientBin}" or in WSL — optional, needed for on-chain anchoring (cargo install casper-client)`
  };
}

export function parseWslQuietList(output: string): string[] {
  return cleanWslText(output)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export function parseWslVerboseList(output: string): string[] {
  return cleanWslText(output)
    .split(/\r?\n/)
    .map(line => line.trim())
    .flatMap(line => {
      if (!line || /^name\s+state\s+version$/i.test(line)) {
        return [];
      }

      const normalized = line.replace(/^\*\s*/, "");
      const match = normalized.match(/^(.+?)\s{2,}\S+\s+\d+\s*$/);

      return match?.[1]?.trim() ? [match[1].trim()] : [];
    });
}

function discoverWslCasperClient(
  spawn: SpawnSyncRunner,
  distro: string,
  clientBin: string,
  explicit: boolean
): CasperClientDiscovery {
  const resolvedClientBin = resolveWslClientBin(spawn, distro, clientBin) ?? clientBin;
  const probe = spawn("wsl", ["-d", distro, "--", resolvedClientBin, "--version"], {
    stdio: "pipe"
  });

  if (probeSucceeded(probe)) {
    return {
      clientBin: resolvedClientBin,
      clientWslDistro: distro,
      found: true,
      success: `casper-client via WSL ${distro}: ${resolvedClientBin}`,
      failure: `casper-client not found via WSL distro "${distro}" at "${clientBin}" — optional, needed for on-chain anchoring`
    };
  }

  return {
    clientBin,
    clientWslDistro: explicit ? distro : null,
    found: false,
    success: `casper-client via WSL ${distro}: ${clientBin}`,
    failure: `casper-client not found via WSL distro "${distro}" at "${clientBin}" — optional, needed for on-chain anchoring`
  };
}

function resolveWslClientBin(
  spawn: SpawnSyncRunner,
  distro: string,
  clientBin: string
): string | null {
  const command = `command -v ${shellQuote(clientBin)}`;
  const probe = spawn("wsl", ["-d", distro, "--", "sh", "-lc", command], {
    stdio: "pipe"
  });

  if (!probeSucceeded(probe)) {
    return null;
  }

  return decodeProcessOutput(probe.stdout).split(/\r?\n/)[0]?.trim() || null;
}

function listWslDistros(spawn: SpawnSyncRunner): string[] {
  const quiet = spawn("wsl", ["--list", "--quiet"], { stdio: "pipe" });
  const quietDistros = parseWslQuietList(decodeProcessOutput(quiet.stdout));
  if (quietDistros.length > 0) {
    return prioritizeWslDistros(quietDistros);
  }

  const verbose = spawn("wsl", ["--list", "--verbose"], { stdio: "pipe" });
  const verboseDistros = parseWslVerboseList(decodeProcessOutput(verbose.stdout));

  return prioritizeWslDistros(verboseDistros);
}

function prioritizeWslDistros(distros: string[]): string[] {
  return [...new Set(distros)].sort((left, right) => distroScore(right) - distroScore(left));
}

function distroScore(value: string): number {
  if (/^ubuntu/i.test(value)) return 100;
  if (/debian/i.test(value)) return 90;
  if (/kali|fedora|opensuse|suse|alma|rocky/i.test(value)) return 80;
  if (/docker/i.test(value)) return -100;

  return 0;
}

function probeSucceeded(result: ReturnType<SpawnSyncRunner>): boolean {
  return !result.error && result.status === 0;
}

function decodeProcessOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Buffer.isBuffer(value)) {
    return "";
  }

  const hasNulBytes = value.some(byte => byte === 0);
  return hasNulBytes ? value.toString("utf16le") : value.toString("utf8");
}

function cleanWslText(value: string): string {
  return value.replaceAll("\u0000", "");
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
