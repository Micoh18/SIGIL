export type PaymentFetchInput = {
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount?: string;
  idempotency_key?: string;
};

export type PaymentPreflightInput = PaymentFetchInput;

export type PaymentDenialReason =
  | "policy_not_found"
  | "policy_disabled"
  | "url_not_allowed"
  | "method_not_allowed"
  | "amount_over_limit";

export type PaymentStatus =
  | "created"
  | "policy_checked"
  | "ready_for_x402_challenge"
  | "policy_denied"
  | "requirements_received"
  | "signed"
  | "submitted"
  | "settled"
  | "failed"
  | "settlement_unavailable";

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
  status: "policy_checked";
  next_state: "ready_for_x402_challenge";
  agent_id: string;
  policy_id: string;
  method: string;
  url: string;
  expected_amount: string | null;
  policy_hash: string;
  idempotency_key: string | null;
  persisted: true;
  settlement: "not_started";
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
