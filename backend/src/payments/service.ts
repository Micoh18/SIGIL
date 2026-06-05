import { randomUUID } from "node:crypto";
import type { GrimoireService } from "../grimoire/service.js";
import type {
  PaymentDenialReason,
  PaymentPreflightInput,
  PaymentPreflightResult
} from "./types.js";

export class PaymentService {
  constructor(private readonly grimoireService: GrimoireService) {}

  async preflightFetch(input: PaymentPreflightInput): Promise<PaymentPreflightResult> {
    const method = input.method.toUpperCase();
    const policy = await this.grimoireService.getPolicy(input.agent_id, input.policy_id);

    if (!policy) {
      return denied(input, "policy_not_found");
    }

    if (!policy.enabled) {
      return denied(input, "policy_disabled");
    }

    if (!policy.allowed_urls.includes(input.url)) {
      return denied(input, "url_not_allowed");
    }

    if (!policy.allowed_methods.includes(method)) {
      return denied(input, "method_not_allowed");
    }

    if (
      input.expected_amount &&
      compareDecimal(input.expected_amount, policy.max_amount_per_call) > 0
    ) {
      return denied(input, "amount_over_limit");
    }

    return {
      allowed: true,
      payment_id: createPaymentId(),
      status: "policy_checked",
      next_state: "ready_for_x402_challenge",
      agent_id: input.agent_id,
      policy_id: input.policy_id,
      method,
      url: input.url,
      expected_amount: input.expected_amount ?? null,
      policy_hash: policy.policy_hash
    };
  }
}

function denied(
  input: PaymentPreflightInput,
  reason: PaymentDenialReason
): PaymentPreflightResult {
  return {
    allowed: false,
    payment_id: null,
    status: "policy_denied",
    reason,
    agent_id: input.agent_id,
    policy_id: input.policy_id,
    method: input.method.toUpperCase(),
    url: input.url,
    expected_amount: input.expected_amount ?? null
  };
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

