import { sha256Hex } from "../memory/hash.js";

export type AnchorSubmission = {
  agent_id: string;
  memory_id: string;
  content_hash: string;
  metadata_hash: string;
  prev_anchor_hash: string | null;
};

export type AnchorSubmissionResult = {
  status: "pending" | "anchored" | "failed";
  anchor_id: string;
  casper_transaction_hash: string | null;
  onchain_content_hash: string | null;
  reason?: string;
};

export type CasperAnchorClient = {
  anchorMemory(submission: AnchorSubmission): Promise<AnchorSubmissionResult>;
};

export class MockCasperAnchorClient implements CasperAnchorClient {
  readonly submissions: AnchorSubmission[] = [];

  async anchorMemory(submission: AnchorSubmission): Promise<AnchorSubmissionResult> {
    this.submissions.push(submission);

    return {
      status: "pending",
      anchor_id: computeAnchorId(submission),
      casper_transaction_hash: null,
      onchain_content_hash: null,
      reason: "casper_client_not_configured"
    };
  }
}

export function computeAnchorId(submission: AnchorSubmission): string {
  return sha256Hex(
    [
      submission.agent_id,
      submission.memory_id,
      submission.content_hash,
      submission.prev_anchor_hash ?? ""
    ].join(":")
  );
}
