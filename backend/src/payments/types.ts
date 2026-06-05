export type PaymentPreflightInput = {
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount?: string;
};

export type PaymentDenialReason =
  | "policy_not_found"
  | "policy_disabled"
  | "url_not_allowed"
  | "method_not_allowed"
  | "amount_over_limit";

export type PaymentPreflightAllowed = {
  allowed: true;
  payment_id: string;
  status: "policy_checked";
  next_state: "ready_for_x402_challenge";
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount: string | null;
  policy_hash: string;
};

export type PaymentPreflightDenied = {
  allowed: false;
  payment_id: null;
  status: "policy_denied";
  reason: PaymentDenialReason;
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount: string | null;
};

export type PaymentPreflightResult = PaymentPreflightAllowed | PaymentPreflightDenied;

