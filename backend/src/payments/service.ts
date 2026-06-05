import { randomUUID } from "node:crypto";
import type { AuditService } from "../audit/service.js";
import type { GrimoireService } from "../grimoire/service.js";
import type { X402ChallengeRequest, X402ChallengeResult } from "../x402/client.js";
import { approveX402Requirements } from "../x402/readiness.js";
import { redactX402Value } from "../x402/redaction.js";
import type {
  PaymentChallengeSummary,
  PaymentDenialReason,
  PaymentFetchAllowed,
  PaymentFetchInput,
  PaymentFetchResult,
  PaymentIntentRecord,
  PaymentReceiptResult,
  PaymentStore
} from "./types.js";

type X402ChallengeRequester = {
  requestChallenge(input: X402ChallengeRequest): Promise<X402ChallengeResult>;
};

type DecimalAmount = {
  value: bigint;
  scale: number;
};

export class PaymentService {
  constructor(
    private readonly grimoireService: GrimoireService,
    private readonly store: PaymentStore,
    private readonly audit?: AuditService,
    private readonly challengeClient?: X402ChallengeRequester
  ) {}

  async preflightFetch(input: PaymentFetchInput): Promise<PaymentFetchResult> {
    return this.fetch({ ...input, request_challenge: false });
  }

  async fetch(input: PaymentFetchInput): Promise<PaymentFetchResult> {
    const method = input.method.toUpperCase();
    const idempotencyKey = input.idempotency_key ?? null;

    if (idempotencyKey) {
      const existing = await this.store.findIntentByIdempotencyKey(input.agent_id, idempotencyKey);
      if (existing) {
        return this.resultFromIntent(existing);
      }
    }

    const now = new Date().toISOString();
    const paymentId = createPaymentId();
    const policy = await this.grimoireService.getPolicy(input.agent_id, input.policy_id);
    let intent: PaymentIntentRecord = {
      id: paymentId,
      agent_id: input.agent_id,
      policy_id: input.policy_id,
      method,
      url: input.url,
      amount: input.expected_amount ?? null,
      status: "created",
      idempotency_key: idempotencyKey,
      policy_hash: null,
      denial_reason: null,
      requirements_json: null,
      signed_payload_hash: null,
      settlement_blocker: null,
      created_at: now,
      updated_at: now
    };

    const denialReason: PaymentDenialReason | null = policy
      ? validatePolicy(input, method, policy)
      : "policy_not_found";
    if (denialReason) {
      intent = {
        ...intent,
        status: "policy_denied",
        denial_reason: denialReason,
        policy_hash: policy?.policy_hash ?? null,
        updated_at: new Date().toISOString()
      };
      await this.store.saveIntent(intent);
      await this.audit?.record({
        agent_id: intent.agent_id,
        event_type: "payment.policy_denied",
        subject_type: "payment",
        subject_id: intent.id,
        severity: "warn",
        metadata: {
          policy_id: intent.policy_id,
          method: intent.method,
          url: intent.url,
          amount: intent.amount,
          reason: denialReason,
          idempotency_key: idempotencyKey
        }
      });
      return this.resultFromIntent(intent);
    }

    intent = {
      ...intent,
      status: "policy_checked",
      policy_hash: policy!.policy_hash,
      updated_at: new Date().toISOString()
    };
    await this.store.saveIntent(intent);
    await this.audit?.record({
      agent_id: intent.agent_id,
      event_type: "payment.policy_approved",
      subject_type: "payment",
      subject_id: intent.id,
      metadata: {
        policy_id: intent.policy_id,
        method: intent.method,
        url: intent.url,
        amount: intent.amount,
        policy_hash: intent.policy_hash,
        idempotency_key: idempotencyKey,
        next_state: "challenge_received",
        request_challenge: input.request_challenge ?? false
      }
    });

    if (input.request_challenge) {
      return this.fetchChallenge(intent, policy!, input.expected_amount ?? null);
    }

    return this.resultFromIntent(intent);
  }

  async receipt(paymentId: string): Promise<PaymentReceiptResult> {
    const intent = await this.store.getIntent(paymentId);
    if (!intent) {
      return { found: false, payment_id: paymentId };
    }

    return {
      found: true,
      payment_id: paymentId,
      intent,
      receipt: await this.store.getReceipt(paymentId)
    };
  }

  private async fetchChallenge(
    intent: PaymentIntentRecord,
    policy: PolicyLike,
    expectedAmount: string | null
  ): Promise<PaymentFetchResult> {
    if (!this.challengeClient) {
      const unavailable = await this.markSettlementUnavailable(
        intent,
        "x402_challenge_client_unavailable"
      );
      return this.resultFromIntent(unavailable, undefined, "x402_challenge_client_unavailable");
    }

    try {
      const challenge = await this.challengeClient.requestChallenge({
        method: intent.method,
        url: intent.url
      });

      if (challenge.status === "payment_required") {
        const safeRequirements = redactX402Value(challenge.requirements);
        const safeRequirementsJson = JSON.stringify(safeRequirements);
        const safeChallenge = {
          ...challenge,
          requirements: safeRequirements,
          requirements_json: safeRequirementsJson
        };
        const updated = {
          ...intent,
          status: "challenge_received" as const,
          requirements_json: safeRequirementsJson,
          updated_at: new Date().toISOString()
        };
        await this.store.saveIntent(updated);

        const approval = approveX402Requirements({
          requirements: challenge.requirements,
          policy,
          method: updated.method,
          url: updated.url,
          expectedAmount
        });

        await this.audit?.record({
          agent_id: updated.agent_id,
          event_type: "payment.challenge_received",
          subject_type: "payment",
          subject_id: updated.id,
          metadata: {
            policy_id: updated.policy_id,
            method: updated.method,
            url: updated.url,
            status_code: challenge.status_code,
            requirements_source: challenge.requirements_source,
            facilitator_url: challenge.facilitator_url,
            resource_url: challenge.resource_url,
            settlement: "not_started",
            requirements_approved: approval.approved,
            selected_requirement_hash: approval.approved
              ? approval.selected_requirement_hash
              : null
          }
        });

        if (!approval.approved) {
          const unavailable = await this.markSettlementUnavailable(
            updated,
            "x402_requirements_not_allowed"
          );
          await this.audit?.record({
            agent_id: unavailable.agent_id,
            event_type: "payment.requirements_rejected",
            subject_type: "payment",
            subject_id: unavailable.id,
            severity: "warn",
            metadata: {
              policy_id: unavailable.policy_id,
              method: unavailable.method,
              url: unavailable.url,
              reason: approval.reason,
              rejected_candidates: approval.rejected_candidates
            }
          });
          return this.resultFromIntent(
            unavailable,
            safeChallenge,
            "x402_requirements_not_allowed"
          );
        }

        return this.resultFromIntent(updated, safeChallenge);
      }

      if (challenge.status === "free_response") {
        await this.audit?.record({
          agent_id: intent.agent_id,
          event_type: "payment.challenge_not_required",
          subject_type: "payment",
          subject_id: intent.id,
          metadata: {
            policy_id: intent.policy_id,
            method: intent.method,
            url: intent.url,
            status_code: challenge.status_code,
            response_hash: challenge.response_hash,
            settlement: "not_required"
          }
        });
        return this.resultFromIntent(intent, challenge);
      }

      const unavailable = await this.markSettlementUnavailable(
        intent,
        "x402_unexpected_resource_response"
      );
      await this.audit?.record({
        agent_id: unavailable.agent_id,
        event_type: "payment.settlement_unavailable",
        subject_type: "payment",
        subject_id: unavailable.id,
        severity: "warn",
        metadata: {
          policy_id: unavailable.policy_id,
          method: unavailable.method,
          url: unavailable.url,
          status_code: challenge.status_code,
          response_hash: challenge.response_hash,
          reason: "x402_unexpected_resource_response"
        }
      });
      return this.resultFromIntent(
        unavailable,
        challenge,
        "x402_unexpected_resource_response"
      );
    } catch (error) {
      const unavailable = await this.markSettlementUnavailable(
        intent,
        "x402_challenge_request_failed"
      );
      await this.audit?.record({
        agent_id: unavailable.agent_id,
        event_type: "payment.settlement_unavailable",
        subject_type: "payment",
        subject_id: unavailable.id,
        severity: "error",
        metadata: {
          policy_id: unavailable.policy_id,
          method: unavailable.method,
          url: unavailable.url,
          reason: "x402_challenge_request_failed",
          error: errorMessage(error)
        }
      });
      return this.resultFromIntent(unavailable, undefined, "x402_challenge_request_failed");
    }
  }

  private async markSettlementUnavailable(
    intent: PaymentIntentRecord,
    reason: string
  ): Promise<PaymentIntentRecord> {
    const updated = {
      ...intent,
      status: "settlement_unavailable" as const,
      settlement_blocker: reason,
      updated_at: new Date().toISOString()
    };
    await this.store.saveIntent(updated);
    if (reason === "x402_challenge_client_unavailable") {
      await this.audit?.record({
        agent_id: updated.agent_id,
        event_type: "payment.settlement_unavailable",
        subject_type: "payment",
        subject_id: updated.id,
        severity: "warn",
        metadata: {
          policy_id: updated.policy_id,
          method: updated.method,
          url: updated.url,
          reason
        }
      });
    }
    return updated;
  }

  private resultFromIntent(
    intent: PaymentIntentRecord,
    challenge?: X402ChallengeResult,
    settlementBlocker?: string
  ): PaymentFetchResult {
    if (intent.status === "policy_denied") {
      return {
        allowed: false,
        payment_id: intent.id,
        status: "policy_denied",
        reason: intent.denial_reason ?? "policy_not_found",
        agent_id: intent.agent_id,
        policy_id: intent.policy_id,
        method: intent.method,
        url: intent.url,
        expected_amount: intent.amount,
        idempotency_key: intent.idempotency_key,
        persisted: true
      };
    }

    const requirements = parseRequirementsJson(intent.requirements_json);
    const result: PaymentFetchAllowed = {
      allowed: true,
      payment_id: intent.id,
      status: intent.status === "created" ? "policy_checked" : intent.status,
      next_state: nextStateFor(intent, challenge),
      agent_id: intent.agent_id,
      policy_id: intent.policy_id,
      method: intent.method,
      url: intent.url,
      expected_amount: intent.amount,
      policy_hash: intent.policy_hash ?? "",
      idempotency_key: intent.idempotency_key,
      persisted: true,
      settlement: settlementFor(intent, challenge),
      requirements_json: intent.requirements_json
    };

    if (requirements.parsed) {
      result.requirements = requirements.value;
    }

    if (challenge) {
      result.challenge = summarizeChallenge(challenge);
    }

    const blocker =
      settlementBlocker ?? intent.settlement_blocker ?? settlementBlockerFor(intent, challenge);
    if (blocker) {
      result.settlement_blocker = blocker;
    }

    return result;
  }
}

function summarizeChallenge(challenge: X402ChallengeResult): PaymentChallengeSummary {
  const summary: PaymentChallengeSummary = {
    status: challenge.status,
    status_code: challenge.status_code,
    facilitator_url: challenge.facilitator_url,
    resource_url: challenge.resource_url,
    request_url: challenge.request_url,
    settlement_status: challenge.settlement_status
  };

  if (challenge.status === "payment_required") {
    summary.requirements = challenge.requirements;
    summary.requirements_json = challenge.requirements_json;
    summary.requirements_source = challenge.requirements_source;
  } else {
    summary.response_hash = challenge.response_hash;
  }

  return summary;
}

function parseRequirementsJson(
  requirementsJson: string | null
): { parsed: true; value: unknown } | { parsed: false } {
  if (!requirementsJson) {
    return { parsed: false };
  }

  try {
    return { parsed: true, value: JSON.parse(requirementsJson) as unknown };
  } catch {
    return { parsed: false };
  }
}

function nextStateFor(
  intent: PaymentIntentRecord,
  challenge?: X402ChallengeResult
): PaymentFetchAllowed["next_state"] {
  if (challenge?.status === "free_response") {
    return null;
  }

  switch (intent.status) {
    case "policy_checked":
      return "challenge_received";
    case "challenge_received":
      return "settlement_unavailable";
    case "created":
    case "policy_denied":
    case "settlement_unavailable":
    case "settled":
      return null;
  }
}

function settlementFor(
  intent: PaymentIntentRecord,
  challenge?: X402ChallengeResult
): PaymentFetchAllowed["settlement"] {
  if (intent.status === "settled") {
    return "settled";
  }

  if (challenge?.status === "free_response") {
    return "not_required";
  }

  if (intent.status === "settlement_unavailable") {
    return "unavailable";
  }

  return "not_started";
}

function settlementBlockerFor(
  intent: PaymentIntentRecord,
  challenge?: X402ChallengeResult
): string | undefined {
  if (challenge?.status === "free_response" || intent.status === "settled") {
    return undefined;
  }

  if (intent.status === "challenge_received") {
    return "signed_payload_not_implemented";
  }

  if (intent.status === "settlement_unavailable") {
    return "x402_settlement_unavailable";
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PolicyLike = Awaited<ReturnType<GrimoireService["getPolicy"]>> extends infer P
  ? NonNullable<P>
  : never;

function validatePolicy(
  input: PaymentFetchInput,
  method: string,
  policy: PolicyLike
): PaymentDenialReason | null {
  if (!policy.enabled) {
    return "policy_disabled";
  }

  const expectedAmount = input.expected_amount
    ? parseDecimalAmount(input.expected_amount)
    : null;
  const maxPerCall = parseDecimalAmount(policy.max_amount_per_call);

  if (input.expected_amount !== undefined && !expectedAmount) {
    return "invalid_amount";
  }

  if (!maxPerCall) {
    return "invalid_amount";
  }

  if (!policy.allowed_urls.includes(input.url)) {
    return "url_not_allowed";
  }

  if (!policy.allowed_methods.includes(method)) {
    return "method_not_allowed";
  }

  if (expectedAmount && compareDecimal(expectedAmount, maxPerCall) > 0) {
    return "amount_over_limit";
  }

  return null;
}

function createPaymentId(): string {
  return `pay_${randomUUID().replaceAll("-", "")}`;
}

function compareDecimal(leftParts: DecimalAmount, rightParts: DecimalAmount): number {
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
}

function parseDecimalAmount(value: string): DecimalAmount | null {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return null;
  }

  const [whole, fraction = ""] = value.split(".");
  return {
    value: BigInt(`${whole}${fraction}`),
    scale: fraction.length
  };
}
