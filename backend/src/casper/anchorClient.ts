import { sha256Hex } from "../memory/hash.js";

const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const CASPER_HASH_PATTERN = /^(hash-)?[a-f0-9]{64}$/i;

export const REAL_CASPER_ANCHOR_ENV_VARS = [
  "CASPER_RPC_URL",
  "CASPER_NETWORK_NAME",
  "MEMORY_ANCHOR_CONTRACT_HASH",
  "MEMORY_ANCHOR_PACKAGE_HASH",
  "CASPER_ACCOUNT_KEY_PATH"
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
  | "casper_transaction_submission_not_implemented";

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
};

export type ValidatedCasperAnchorConfig = {
  networkName: string;
  caip2ChainId: string;
  rpcUrl: string;
  accountKeyPath: string;
  memoryAnchorContractHash: string;
  memoryAnchorPackageHash: string;
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

  constructor(readonly config: ValidatedCasperAnchorConfig) {}

  async anchorMemory(submission: AnchorSubmission): Promise<AnchorSubmissionResult> {
    assertValidAnchorSubmission(submission);
    this.submissions.push(submission);

    return createPendingAnchorResult(
      submission,
      "casper_transaction_submission_not_implemented"
    );
  }
}

export class MockCasperAnchorClient extends UnconfiguredCasperAnchorClient {
  constructor() {
    super("casper_contract_not_configured");
  }
}

export function createCasperAnchorClient(config: CasperAnchorClientConfig): CasperAnchorClient {
  const anchorConfig = validateCasperAnchorConfig(config);

  if (!anchorConfig) {
    return new UnconfiguredCasperAnchorClient();
  }

  return new ConfiguredCasperAnchorClient(anchorConfig);
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
  assertCasperHash("MEMORY_ANCHOR_PACKAGE_HASH", packageHash);

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

  return {
    networkName,
    caip2ChainId,
    rpcUrl,
    accountKeyPath,
    memoryAnchorContractHash: contractHash,
    memoryAnchorPackageHash: packageHash
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
