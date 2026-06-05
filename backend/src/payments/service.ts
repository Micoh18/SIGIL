import { randomUUID } from "node:crypto";
import type { AuditService } from "../audit/service.js";
import type { GrimoireService } from "../grimoire/service.js";
import type {
  PaymentDenialReason,
  PaymentFetchInput,
  PaymentFetchResult,
  PaymentIntentRecord,
  PaymentReceiptResult,
  PaymentStore
} from "./types.js";

export class PaymentService {
  constructor(
    private readonly grimoireService: GrimoireService,
    private readonly store: PaymentStore,
    private readonly audit?: AuditService
  ) {}

  async preflightFetch(input: PaymentFetchInput): Promise<PaymentFetchResult> {
    return this.fetch(input);
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
        next_state: "ready_for_x402_challenge"
      }
    });

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

  private resultFromIntent(intent: PaymentIntentRecord): PaymentFetchResult {
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

    return {
      allowed: true,
      payment_id: intent.id,
      status: "policy_checked",
      next_state: "ready_for_x402_challenge",
      agent_id: intent.agent_id,
      policy_id: intent.policy_id,
      method: intent.method,
      url: intent.url,
      expected_amount: intent.amount,
      policy_hash: intent.policy_hash ?? "",
      idempotency_key: intent.idempotency_key,
      persisted: true,
      settlement: "not_started"
    };
  }
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

  if (!policy.allowed_urls.includes(input.url)) {
    return "url_not_allowed";
  }

  if (!policy.allowed_methods.includes(method)) {
    return "method_not_allowed";
  }

  if (input.expected_amount && compareDecimal(input.expected_amount, policy.max_amount_per_call) > 0) {
    return "amount_over_limit";
  }

  return null;
}

function createPaymentId(): string {
  return `pay_${randomUUID().replaceAll("-", "")}`;
}

function compareDecimal(left: string, right: string): number {
  const leftParts = normalizeDecimal(left);
  const rightParts = normalizeDecimal(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
}

function normalizeDecimal(value: string): { value: bigint; scale: number } {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fraction = ""] = value.split(".");
  return {
    value: BigInt(`${whole}${fraction}`),
    scale: fraction.length
  };
}
