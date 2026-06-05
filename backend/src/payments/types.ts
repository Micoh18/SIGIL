export type PaymentFetchInput = {
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount?: string;
  idempotency_key?: string;
  request_challenge?: boolean;
};

export type PaymentPreflightInput = PaymentFetchInput;

export type PaymentDenialReason =
  | "policy_not_found"
  | "policy_disabled"
  | "url_not_allowed"
  | "method_not_allowed"
  | "amount_over_limit"
  | "invalid_amount";

export type PaymentStatus =
  | "created"
  | "policy_denied"
  | "policy_checked"
  | "challenge_received"
  | "settlement_unavailable"
  | "settled";

export type PaymentNextState =
  | "ready_for_x402_challenge"
  | "challenge_received"
  | "settlement_unavailable"
  | null;

export type PaymentSettlementState = "not_started" | "not_required" | "unavailable" | "settled";

export type PaymentChallengeSummary = {
  status: "payment_required" | "free_response" | "unexpected_response";
  status_code: number;
  facilitator_url: string | null;
  resource_url: string | null;
  request_url: string;
  settlement_status: "not_started" | "not_required";
  requirements_json?: string | null;
  requirements?: unknown;
  requirements_source?: string;
  response_hash?: string;
};

export type PaymentIntentRecord = {
  id: string;
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  amount: string | null;
  status: PaymentStatus;
  idempotency_key: string | null;
  policy_hash: string | null;
  denial_reason: PaymentDenialReason | null;
  requirements_json: string | null;
  signed_payload_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentReceiptRecord = {
  id: string;
  payment_id: string;
  facilitator_url: string;
  casper_transaction_hash: string | null;
  settlement_status: "pending" | "settled" | "failed" | "settlement_unavailable";
  response_hash: string | null;
  response_status: number | null;
  receipt_json: string;
  created_at: string;
};

export type PaymentStore = {
  saveIntent(intent: PaymentIntentRecord): Promise<void>;
  getIntent(paymentId: string): Promise<PaymentIntentRecord | null>;
  findIntentByIdempotencyKey(agentId: string, idempotencyKey: string): Promise<PaymentIntentRecord | null>;
  saveReceipt(receipt: PaymentReceiptRecord): Promise<void>;
  getReceipt(paymentId: string): Promise<PaymentReceiptRecord | null>;
};

export type PaymentFetchAllowed = {
  allowed: true;
  payment_id: string;
  status: "policy_checked" | "challenge_received" | "settlement_unavailable" | "settled";
  next_state: PaymentNextState;
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount: string | null;
  policy_hash: string;
  idempotency_key: string | null;
  persisted: true;
  settlement: PaymentSettlementState;
  requirements_json: string | null;
  requirements?: unknown;
  challenge?: PaymentChallengeSummary;
  settlement_blocker?: string;
};

export type PaymentFetchDenied = {
  allowed: false;
  payment_id: string;
  status: "policy_denied";
  reason: PaymentDenialReason;
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount: string | null;
  idempotency_key: string | null;
  persisted: true;
};

export type PaymentFetchResult = PaymentFetchAllowed | PaymentFetchDenied;
export type PaymentPreflightResult = PaymentFetchResult;

export type PaymentReceiptResult = {
  found: boolean;
  payment_id: string;
  intent?: PaymentIntentRecord;
  receipt?: PaymentReceiptRecord | null;
};
