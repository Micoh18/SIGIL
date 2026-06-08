import { createHash, randomUUID } from "node:crypto";
import type { AuditService } from "../audit/service.js";
import type { GrimoireService } from "../grimoire/service.js";
import type { JsonObject } from "../memory/types.js";
import type { X402ChallengeRequest, X402ChallengeResult } from "../x402/client.js";
import {
  addDecimalParts,
  compareDecimal,
  normalizePaymentAmountForComparison
} from "../x402/normalization.js";
import { approveX402Requirements } from "../x402/readiness.js";
import { redactX402Value } from "../x402/redaction.js";
import type {
  X402SettlementOutcome,
  X402SettlementProvider
} from "../x402/settlement.js";
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

export class PaymentService {
  constructor(
    private readonly grimoireService: GrimoireService,
    private readonly store: PaymentStore,
    private readonly audit?: AuditService,
    private readonly challengeClient?: X402ChallengeRequester,
    private readonly settlementProvider?: X402SettlementProvider
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

        return this.settleApprovedRequirement(
          updated,
          safeChallenge,
          approval.selected_requirement,
          approval.selected_requirement_hash
        );
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

  private async settleApprovedRequirement(
    intent: PaymentIntentRecord,
    challenge: Extract<X402ChallengeResult, { status: "payment_required" }>,
    selectedRequirement: JsonObject,
    selectedRequirementHash: string
  ): Promise<PaymentFetchResult> {
    if (!this.settlementProvider) {
      const unavailable = await this.markSettlementUnavailable(
        intent,
        "x402_settlement_provider_unavailable"
      );
      await this.persistSettlementReceipt(
        unavailable,
        {
          status: "unavailable",
          blocker: "x402_settlement_provider_unavailable",
          signed_payload_hash: null,
          response_status: null,
          casper_transaction_hash: null,
          receipt_json: JSON.stringify({
            status: "settlement_unavailable",
            blocker: "x402_settlement_provider_unavailable",
            payment_id: unavailable.id,
            selected_requirement_hash: selectedRequirementHash
          })
        },
        challenge.facilitator_url
      );
      return this.resultFromIntent(
        unavailable,
        challenge,
        "x402_settlement_provider_unavailable"
      );
    }

    const selectedAmount = amountFromRequirement(selectedRequirement) ?? intent.amount;
    if (selectedAmount) {
      const periodCheck = await this.checkCurrentPeriodSpend(intent, selectedAmount);
      if (!periodCheck.allowed) {
        const unavailable = await this.markSettlementUnavailable(
          intent,
          periodCheck.reason
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
            selected_requirement_hash: selectedRequirementHash,
            reason: periodCheck.reason
          }
        });
        return this.resultFromIntent(unavailable, challenge, periodCheck.reason);
      }
    }

    const settlement = await this.settlementProvider.settle({
      payment_id: intent.id,
      facilitator_url: challenge.facilitator_url,
      method: intent.method,
      url: intent.url,
      selected_requirement: selectedRequirement,
      selected_requirement_hash: selectedRequirementHash,
      policy_hash: intent.policy_hash ?? ""
    });

    if (settlement.status === "settled") {
      const settledIntent = {
        ...intent,
        status: "settled" as const,
        signed_payload_hash: settlement.signed_payload_hash,
        settlement_blocker: null,
        updated_at: new Date().toISOString()
      };
      await this.store.saveIntent(settledIntent);
      await this.persistSettlementReceipt(settledIntent, settlement, challenge.facilitator_url);
      if (selectedAmount) {
        await this.grimoireService.recordPolicySpend(
          settledIntent.agent_id,
          settledIntent.policy_id,
          selectedAmount
        );
      }
      await this.audit?.record({
        agent_id: settledIntent.agent_id,
        event_type: "payment.settled",
        subject_type: "payment",
        subject_id: settledIntent.id,
        metadata: {
          policy_id: settledIntent.policy_id,
          method: settledIntent.method,
          url: settledIntent.url,
          selected_requirement_hash: selectedRequirementHash,
          signed_payload_hash: settlement.signed_payload_hash,
          casper_transaction_hash: settlement.casper_transaction_hash
        }
      });
      return this.resultFromIntent(settledIntent, challenge);
    }

    const unavailable = {
      ...intent,
      status: "settlement_unavailable" as const,
      signed_payload_hash: settlement.signed_payload_hash,
      settlement_blocker: settlement.blocker,
      updated_at: new Date().toISOString()
    };
    await this.store.saveIntent(unavailable);
    await this.persistSettlementReceipt(unavailable, settlement, challenge.facilitator_url);
    await this.audit?.record({
      agent_id: unavailable.agent_id,
      event_type: "payment.settlement_unavailable",
      subject_type: "payment",
      subject_id: unavailable.id,
      severity: settlement.status === "failed" ? "error" : "warn",
      metadata: {
        policy_id: unavailable.policy_id,
        method: unavailable.method,
        url: unavailable.url,
        selected_requirement_hash: selectedRequirementHash,
        signed_payload_hash: settlement.signed_payload_hash,
        reason: settlement.blocker
      }
    });

    return this.resultFromIntent(unavailable, challenge, settlement.blocker);
  }

  private async checkCurrentPeriodSpend(
    intent: PaymentIntentRecord,
    amount: string
  ): Promise<
    | {
        allowed: true;
      }
    | {
        allowed: false;
        reason: "policy_period_limit_exceeded" | "policy_period_amount_invalid";
      }
  > {
    const policy = await this.grimoireService.getPolicy(intent.agent_id, intent.policy_id);
    if (!policy) {
      return { allowed: false, reason: "policy_period_amount_invalid" };
    }

    const context = { policy: policy.allowed_asset };
    const amountParts = normalizePaymentAmountForComparison(amount, context);
    const maxPeriod = normalizePaymentAmountForComparison(policy.max_amount_per_period, context);
    const currentSpend = normalizePaymentAmountForComparison(currentPeriodSpend(policy), context);
    if (!amountParts || !maxPeriod || !currentSpend) {
      return { allowed: false, reason: "policy_period_amount_invalid" };
    }

    if (compareDecimal(addDecimalParts(currentSpend, amountParts), maxPeriod) > 0) {
      return { allowed: false, reason: "policy_period_limit_exceeded" };
    }

    return { allowed: true };
  }

  private async persistSettlementReceipt(
    intent: PaymentIntentRecord,
    settlement: X402SettlementOutcome,
    facilitatorUrl: string | null
  ): Promise<void> {
    await this.store.saveReceipt({
      id: createPaymentReceiptId(),
      payment_id: intent.id,
      facilitator_url: facilitatorUrl ?? "unconfigured",
      casper_transaction_hash: settlement.casper_transaction_hash,
      settlement_status:
        settlement.status === "settled"
          ? "settled"
          : settlement.status === "failed"
            ? "failed"
            : "settlement_unavailable",
      response_hash: settlement.receipt_json ? hashReceipt(settlement.receipt_json) : null,
      response_status: settlement.response_status,
      receipt_json: settlement.receipt_json,
      created_at: new Date().toISOString()
    });
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
    return "x402_settlement_provider_unavailable";
  }

  if (intent.status === "settlement_unavailable") {
    return "x402_settlement_unavailable";
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function amountFromRequirement(requirement: JsonObject): string | null {
  for (const key of ["maxAmountRequired", "amount", "max_amount_required"]) {
    const value = requirement[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
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

  const context = { policy: policy.allowed_asset };
  const expectedAmount = input.expected_amount
    ? normalizePaymentAmountForComparison(input.expected_amount, context)
    : null;
  const maxPerCall = normalizePaymentAmountForComparison(policy.max_amount_per_call, context);

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

  if (expectedAmount) {
    const maxPeriod = normalizePaymentAmountForComparison(policy.max_amount_per_period, context);
    const currentSpend = normalizePaymentAmountForComparison(currentPeriodSpend(policy), context);
    if (!maxPeriod || !currentSpend) {
      return "invalid_amount";
    }

    if (compareDecimal(addDecimalParts(currentSpend, expectedAmount), maxPeriod) > 0) {
      return "period_limit_exceeded";
    }
  }

  return null;
}

function createPaymentId(): string {
  return `pay_${randomUUID().replaceAll("-", "")}`;
}

function createPaymentReceiptId(): string {
  return `receipt_${randomUUID().replaceAll("-", "")}`;
}

function hashReceipt(receiptJson: string): string {
  return createHash("sha256").update(receiptJson).digest("hex");
}

function currentPeriodSpend(policy: PolicyLike, now: Date = new Date()): string {
  const periodStartedAt = Date.parse(policy.period_started_at);
  if (
    Number.isNaN(periodStartedAt) ||
    now.getTime() - periodStartedAt >= policy.period_seconds * 1000
  ) {
    return "0";
  }

  return policy.current_period_spend;
}
