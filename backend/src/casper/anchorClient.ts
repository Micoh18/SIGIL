import { spawn } from "node:child_process";
import { sha256Hex } from "../memory/hash.js";

const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const CASPER_HASH_PATTERN = /^(hash-)?[a-f0-9]{64}$/i;
const CASPER_PACKAGE_HASH_PATTERN = /^(hash-|package-)?[a-f0-9]{64}$/i;

export const REAL_CASPER_ANCHOR_ENV_VARS = [
  "CASPER_RPC_URL",
  "CASPER_NETWORK_NAME",
  "MEMORY_ANCHOR_CONTRACT_HASH",
  "MEMORY_ANCHOR_PACKAGE_HASH",
  "CASPER_ACCOUNT_KEY_PATH",
  "CASPER_ENABLE_REAL_SUBMISSION"
] as const;

export type AnchorMemoryRequest = {
  agent_id: string;
  memory_id: string;
  content_hash: string;
  metadata_hash: string;
  prev_anchor_hash: string | null;
};

export type AnchorSubmission = {
  anchor_id: string;
  agent_id_hash: string;
  memory_id_hash: string;
  content_hash: string;
  metadata_hash: string;
  prev_anchor_hash: string | null;
};

export type AnchorSubmissionReason =
  | "casper_contract_not_configured"
  | "casper_client_not_configured"
  | "casper_transaction_submission_disabled"
  | "casper_transaction_submission_failed"
  | "casper_transaction_hash_missing";

export type AnchorSubmissionResult = {
  status: "pending" | "anchored" | "failed";
  anchor_id: string;
  casper_transaction_hash: string | null;
  onchain_content_hash: string | null;
  reason?: AnchorSubmissionReason;
};

export type CasperAnchorClient = {
  readonly mode: "unconfigured" | "configured";
  anchorMemory(submission: AnchorSubmission): Promise<AnchorSubmissionResult>;
};

export type CasperAnchorClientConfig = {
  networkName: string;
  caip2ChainId: string;
  rpcUrl: string | null;
  accountKeyPath: string | null;
  memoryAnchorContractHash: string | null;
  memoryAnchorPackageHash: string | null;
  submissionEnabled?: boolean;
  clientBin?: string;
  clientWslDistro?: string | null;
  anchorSubmissionMode?: "transaction-package" | "deploy-contract-hash";
  gasPriceTolerance?: string;
  pricingMode?: string;
  anchorPaymentAmountMotes?: string;
};

export type ValidatedCasperAnchorConfig = {
  networkName: string;
  caip2ChainId: string;
  rpcUrl: string;
  accountKeyPath: string;
  memoryAnchorContractHash: string;
  memoryAnchorPackageHash: string;
  submissionEnabled: boolean;
  clientBin: string;
  clientWslDistro: string | null;
  anchorSubmissionMode: "transaction-package" | "deploy-contract-hash";
  gasPriceTolerance: string;
  pricingMode: string;
  anchorPaymentAmountMotes: string;
};

export type CasperCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CasperCommandRunner = (
  command: string,
  args: readonly string[]
) => Promise<CasperCommandResult>;

export type CasperAnchorClientOptions = {
  commandRunner?: CasperCommandRunner;
};

export type CasperCommandInvocation = {
  command: string;
  args: string[];
};

export class UnconfiguredCasperAnchorClient implements CasperAnchorClient {
  readonly mode = "unconfigured" as const;
  readonly submissions: AnchorSubmission[] = [];

  constructor(private readonly reason: AnchorSubmissionReason = "casper_contract_not_configured") {}

  async anchorMemory(submission: AnchorSubmission): Promise<AnchorSubmissionResult> {
    assertValidAnchorSubmission(submission);
    this.submissions.push(submission);

    return createPendingAnchorResult(submission, this.reason);
  }
}

export class ConfiguredCasperAnchorClient implements CasperAnchorClient {
  readonly mode = "configured" as const;
  readonly submissions: AnchorSubmission[] = [];

  constructor(
    readonly config: ValidatedCasperAnchorConfig,
    private readonly commandRunner: CasperCommandRunner = runCasperCommand
  ) {}

  async anchorMemory(submission: AnchorSubmission): Promise<AnchorSubmissionResult> {
    assertValidAnchorSubmission(submission);
    this.submissions.push(submission);

    if (!this.config.submissionEnabled) {
      return createPendingAnchorResult(
        submission,
        "casper_transaction_submission_disabled"
      );
    }

    const invocation = buildCasperAnchorCommand(this.config, submission);
    let commandResult: CasperCommandResult;

    try {
      commandResult = await this.commandRunner(invocation.command, invocation.args);
    } catch {
      return createFailedAnchorResult(submission, "casper_transaction_submission_failed");
    }

    if (commandResult.exitCode !== 0) {
      return createFailedAnchorResult(submission, "casper_transaction_submission_failed");
    }

    const transactionHash = extractCasperTransactionHash(commandResult);
    if (!transactionHash) {
      return createFailedAnchorResult(submission, "casper_transaction_hash_missing");
    }

    return createSubmittedAnchorResult(submission, transactionHash);
  }
}

export class MockCasperAnchorClient extends UnconfiguredCasperAnchorClient {
  constructor() {
    super("casper_contract_not_configured");
  }
}

export function createCasperAnchorClient(
  config: CasperAnchorClientConfig,
  options: CasperAnchorClientOptions = {}
): CasperAnchorClient {
  const anchorConfig = validateCasperAnchorConfig(config);

  if (!anchorConfig) {
    return new UnconfiguredCasperAnchorClient();
  }

  return new ConfiguredCasperAnchorClient(anchorConfig, options.commandRunner);
}

export function validateCasperAnchorConfig(
  config: CasperAnchorClientConfig
): ValidatedCasperAnchorConfig | null {
  const contractHash = normalizeOptional(config.memoryAnchorContractHash);

  if (!contractHash) {
    return null;
  }

  assertCasperHash("MEMORY_ANCHOR_CONTRACT_HASH", contractHash);

  const packageHash = requireNonEmpty(
    config.memoryAnchorPackageHash,
    "MEMORY_ANCHOR_PACKAGE_HASH when MEMORY_ANCHOR_CONTRACT_HASH is set"
  );
  assertCasperPackageHash("MEMORY_ANCHOR_PACKAGE_HASH", packageHash);

  const networkName = requireNonEmpty(config.networkName, "CASPER_NETWORK_NAME");
  const caip2ChainId = requireNonEmpty(config.caip2ChainId, "CASPER_CAIP2_CHAIN_ID");
  const rpcUrl = requireNonEmpty(
    config.rpcUrl,
    "CASPER_RPC_URL when MEMORY_ANCHOR_CONTRACT_HASH is set"
  );
  const accountKeyPath = requireNonEmpty(
    config.accountKeyPath,
    "CASPER_ACCOUNT_KEY_PATH when MEMORY_ANCHOR_CONTRACT_HASH is set"
  );

  assertHttpUrl("CASPER_RPC_URL", rpcUrl);
  assertUnsignedInteger("CASPER_GAS_PRICE_TOLERANCE", config.gasPriceTolerance ?? "10");
  assertPricingMode("CASPER_PRICING_MODE", config.pricingMode ?? "classic");
  assertUnsignedInteger(
    "CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES",
    config.anchorPaymentAmountMotes ?? "3000000000"
  );

  return {
    networkName,
    caip2ChainId,
    rpcUrl,
    accountKeyPath,
    memoryAnchorContractHash: contractHash,
    memoryAnchorPackageHash: packageHash,
    submissionEnabled: config.submissionEnabled ?? false,
    clientBin: requireNonEmpty(config.clientBin ?? "casper-client", "CASPER_CLIENT_BIN"),
    clientWslDistro: normalizeOptional(config.clientWslDistro),
    anchorSubmissionMode: config.anchorSubmissionMode ?? "transaction-package",
    gasPriceTolerance: requireNonEmpty(
      config.gasPriceTolerance ?? "10",
      "CASPER_GAS_PRICE_TOLERANCE"
    ),
    pricingMode: requireNonEmpty(config.pricingMode ?? "classic", "CASPER_PRICING_MODE"),
    anchorPaymentAmountMotes: requireNonEmpty(
      config.anchorPaymentAmountMotes ?? "3000000000",
      "CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES"
    )
  };
}

export function createAnchorSubmission(input: AnchorMemoryRequest): AnchorSubmission {
  assertNonEmpty("agent_id", input.agent_id);
  assertNonEmpty("memory_id", input.memory_id);
  assertHex64("content_hash", input.content_hash);
  assertHex64("metadata_hash", input.metadata_hash);

  if (input.prev_anchor_hash !== null) {
    assertHex64("prev_anchor_hash", input.prev_anchor_hash);
  }

  return {
    anchor_id: computeAnchorId(input),
    agent_id_hash: sha256Hex(input.agent_id),
    memory_id_hash: sha256Hex(input.memory_id),
    content_hash: input.content_hash,
    metadata_hash: input.metadata_hash,
    prev_anchor_hash: input.prev_anchor_hash
  };
}

export function createPendingAnchorResult(
  submission: AnchorSubmission,
  reason: AnchorSubmissionReason
): AnchorSubmissionResult {
  assertValidAnchorSubmission(submission);

  return {
    status: "pending",
    anchor_id: submission.anchor_id,
    casper_transaction_hash: null,
    onchain_content_hash: null,
    reason
  };
}

export function createFailedAnchorResult(
  submission: AnchorSubmission,
  reason: AnchorSubmissionReason
): AnchorSubmissionResult {
  assertValidAnchorSubmission(submission);

  return {
    status: "failed",
    anchor_id: submission.anchor_id,
    casper_transaction_hash: null,
    onchain_content_hash: null,
    reason
  };
}

export function createAnchoredAnchorResult(
  submission: AnchorSubmission,
  casperTransactionHash: string
): AnchorSubmissionResult {
  assertValidAnchorSubmission(submission);
  assertHex64("casper_transaction_hash", casperTransactionHash);

  return {
    status: "anchored",
    anchor_id: submission.anchor_id,
    casper_transaction_hash: casperTransactionHash,
    onchain_content_hash: submission.content_hash
  };
}

export function createSubmittedAnchorResult(
  submission: AnchorSubmission,
  casperTransactionHash: string
): AnchorSubmissionResult {
  assertValidAnchorSubmission(submission);
  assertHex64("casper_transaction_hash", casperTransactionHash);

  return {
    status: "pending",
    anchor_id: submission.anchor_id,
    casper_transaction_hash: casperTransactionHash,
    onchain_content_hash: null
  };
}

export function computeAnchorId(input: AnchorMemoryRequest): string {
  return sha256Hex(
    [
      input.agent_id,
      input.memory_id,
      input.content_hash,
      input.prev_anchor_hash ?? ""
    ].join(":")
  );
}

export function buildCasperAnchorCommand(
  config: ValidatedCasperAnchorConfig,
  submission: AnchorSubmission
): CasperCommandInvocation {
  assertValidAnchorSubmission(submission);

  const sessionArgs = [
    "--session-args-json",
    JSON.stringify([
      sessionJsonArg("anchor_id", submission.anchor_id),
      sessionJsonArg("agent_id_hash", submission.agent_id_hash),
      sessionJsonArg("memory_id_hash", submission.memory_id_hash),
      sessionJsonArg("content_hash", submission.content_hash),
      sessionJsonArg("metadata_hash", submission.metadata_hash),
      sessionJsonArg("prev_anchor_hash", submission.prev_anchor_hash ?? "")
    ])
  ];

  if (config.anchorSubmissionMode === "deploy-contract-hash") {
    return wrapCasperCommand(config, [
        "put-deploy",
        "--node-address",
        config.rpcUrl,
        "--chain-name",
        config.networkName,
        "--session-hash",
        formatContractHash(config.memoryAnchorContractHash),
        "--session-entry-point",
        "anchor_memory",
        "--payment-amount",
        config.anchorPaymentAmountMotes,
        "--secret-key",
        config.accountKeyPath,
        ...sessionArgs
      ]);
  }

  return wrapCasperCommand(config, [
      "put-transaction",
      "package",
      "--node-address",
      config.rpcUrl,
      "--chain-name",
      config.networkName,
      "--contract-package-hash",
      formatContractPackageHash(config.memoryAnchorPackageHash),
      "--session-entry-point",
      "anchor_memory",
      "--gas-price-tolerance",
      config.gasPriceTolerance,
      "--pricing-mode",
      config.pricingMode,
      "--payment-amount",
      config.anchorPaymentAmountMotes,
      "--standard-payment",
      "true",
      "--secret-key",
      config.accountKeyPath,
      ...sessionArgs
    ]);
}

export function extractCasperTransactionHash(result: CasperCommandResult): string | null {
  for (const output of [result.stdout, result.stderr]) {
    const json = parseCasperClientJson(output);
    const jsonHash = json ? findHashField(json) : null;
    if (jsonHash) {
      return jsonHash;
    }

    const labelledHash = findLabelledHash(output);
    if (labelledHash) {
      return labelledHash;
    }
  }

  return null;
}

function assertValidAnchorSubmission(submission: AnchorSubmission): void {
  assertHex64("anchor_id", submission.anchor_id);
  assertHex64("agent_id_hash", submission.agent_id_hash);
  assertHex64("memory_id_hash", submission.memory_id_hash);
  assertHex64("content_hash", submission.content_hash);
  assertHex64("metadata_hash", submission.metadata_hash);

  if (submission.prev_anchor_hash !== null) {
    assertHex64("prev_anchor_hash", submission.prev_anchor_hash);
  }
}

function assertHex64(name: string, value: string): void {
  if (!HEX_64_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase 64-character hex string`);
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

function assertHttpUrl(name: string, value: string): void {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an HTTP(S) URL`);
  }
}

function requireNonEmpty(value: string | null, name: string): string {
  const normalized = normalizeOptional(value);

  if (!normalized) {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function runCasperCommand(command: string, args: readonly string[]): Promise<CasperCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

function wrapCasperCommand(
  config: ValidatedCasperAnchorConfig,
  args: string[]
): CasperCommandInvocation {
  if (!config.clientWslDistro) {
    return {
      command: config.clientBin,
      args
    };
  }

  return {
    command: "wsl",
    args: ["-d", config.clientWslDistro, "--", config.clientBin, ...args]
  };
}

function sessionJsonArg(name: string, value: string): { name: string; type: "String"; value: string } {
  return { name, type: "String", value };
}

function formatContractPackageHash(value: string): string {
  const normalized = value.toLowerCase().replace(/^(hash-|package-)/, "");

  return `hash-${normalized}`;
}

function formatContractHash(value: string): string {
  const normalized = value.toLowerCase().replace(/^hash-/, "");

  return `hash-${normalized}`;
}

function parseCasperClientJson(output: string): unknown | null {
  const trimmed = output.trim();

  if (!trimmed) {
    return null;
  }

  for (const candidate of [trimmed, jsonObjectSlice(trimmed)]) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function jsonObjectSlice(output: string): string | null {
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return output.slice(firstBrace, lastBrace + 1);
}

function findHashField(value: unknown): string | null {
  if (typeof value === "string") {
    return HEX_64_PATTERN.test(value.toLowerCase()) ? value.toLowerCase() : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["transaction_hash", "deploy_hash"]) {
    const direct = record[key];
    const hash = extractHashValue(direct);
    if (hash) {
      return hash;
    }
  }

  for (const nested of Object.values(record)) {
    const hash = findHashField(nested);
    if (hash) {
      return hash;
    }
  }

  return null;
}

function extractHashValue(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();

    return HEX_64_PATTERN.test(normalized) ? normalized : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    const hash = extractHashValue(nested);
    if (hash) {
      return hash;
    }
  }

  return null;
}

function findLabelledHash(output: string): string | null {
  const match = output.match(
    /(?:transaction_hash|deploy_hash)[\s"'=:{}A-Za-z0-9]*?([a-f0-9]{64})/i
  );

  return match?.[1]?.toLowerCase() ?? null;
}
