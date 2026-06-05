import { canonicalizeJson, toJsonObject, toJsonValue } from "../memory/canonical.js";
import type { JsonObject } from "../memory/types.js";
import { sha256Hex } from "../memory/hash.js";
import { redactX402Value } from "./redaction.js";
import { verifyX402SettlementResponse } from "./readiness.js";

export type X402SettlementBlocker =
  | "x402_settlement_disabled"
  | "x402_settlement_provider_unavailable"
  | "x402_signing_provider_not_configured"
  | "x402_facilitator_verify_failed"
  | "x402_facilitator_settle_failed"
  | "x402_facilitator_settlement_not_verified";

export type X402SettlementInput = {
  payment_id: string;
  facilitator_url: string | null;
  method: string;
  url: string;
  selected_requirement: JsonObject;
  selected_requirement_hash: string;
  policy_hash: string;
};

export type X402SigningInput = X402SettlementInput;

export type X402SigningResult =
  | {
      signed: true;
      signed_payload: JsonObject;
      signed_payload_hash: string;
    }
  | {
      signed: false;
      blocker: X402SettlementBlocker;
    };

export type X402SignedPaymentProvider = {
  sign(input: X402SigningInput): Promise<X402SigningResult>;
};

export type X402SettlementOutcome =
  | {
      status: "unavailable";
      blocker: X402SettlementBlocker;
      signed_payload_hash: string | null;
      response_status: number | null;
      casper_transaction_hash: null;
      receipt_json: string;
    }
  | {
      status: "failed";
      blocker: X402SettlementBlocker;
      signed_payload_hash: string | null;
      response_status: number | null;
      casper_transaction_hash: string | null;
      receipt_json: string;
    }
  | {
      status: "settled";
      signed_payload_hash: string;
      response_status: number;
      casper_transaction_hash: string;
      receipt_json: string;
    };

export type X402SettlementProvider = {
  settle(input: X402SettlementInput): Promise<X402SettlementOutcome>;
};

export type X402JsonPostResult = {
  status: number;
  body: unknown;
};

export type X402JsonPoster = (
  url: string,
  body: JsonObject
) => Promise<X402JsonPostResult>;

export class DisabledX402SettlementProvider implements X402SettlementProvider {
  constructor(
    private readonly blocker: X402SettlementBlocker = "x402_settlement_disabled"
  ) {}

  async settle(input: X402SettlementInput): Promise<X402SettlementOutcome> {
    return {
      status: "unavailable",
      blocker: this.blocker,
      signed_payload_hash: null,
      response_status: null,
      casper_transaction_hash: null,
      receipt_json: settlementReceiptJson({
        status: "settlement_unavailable",
        blocker: this.blocker,
        payment_id: input.payment_id,
        selected_requirement_hash: input.selected_requirement_hash,
        facilitator_url: input.facilitator_url
      })
    };
  }
}

export class DisabledX402SigningProvider implements X402SignedPaymentProvider {
  async sign(): Promise<X402SigningResult> {
    return {
      signed: false,
      blocker: "x402_signing_provider_not_configured"
    };
  }
}

export class FacilitatorX402SettlementProvider implements X402SettlementProvider {
  constructor(
    private readonly signer: X402SignedPaymentProvider,
    private readonly postJson: X402JsonPoster = postJsonWithFetch
  ) {}

  async settle(input: X402SettlementInput): Promise<X402SettlementOutcome> {
    const signed = await this.signer.sign(input);
    if (!signed.signed) {
      return {
        status: "unavailable",
        blocker: signed.blocker,
        signed_payload_hash: null,
        response_status: null,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "settlement_unavailable",
          blocker: signed.blocker,
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url
        })
      };
    }

    const verify = await this.postJson(facilitatorEndpoint(input.facilitator_url, "verify"), {
      paymentPayload: signed.signed_payload,
      paymentRequirements: input.selected_requirement
    });
    const verifyObject = tryJsonObject(verify.body);
    if (!verifyObject) {
      return {
        status: "failed",
        blocker: "x402_facilitator_verify_failed",
        signed_payload_hash: signed.signed_payload_hash,
        response_status: verify.status,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "verify_failed",
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url,
          verify_response: verify.body
        })
      };
    }
    const verifyAccepted =
      verify.status >= 200 &&
      verify.status < 300 &&
      (verifyObject.valid === true || verifyObject.success === true);

    if (!verifyAccepted) {
      return {
        status: "failed",
        blocker: "x402_facilitator_verify_failed",
        signed_payload_hash: signed.signed_payload_hash,
        response_status: verify.status,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "verify_failed",
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url,
          verify_response: verifyObject
        })
      };
    }

    const settle = await this.postJson(facilitatorEndpoint(input.facilitator_url, "settle"), {
      paymentPayload: signed.signed_payload,
      paymentRequirements: input.selected_requirement
    });
    const settlement = verifyX402SettlementResponse(settle.body);
    if (!settlement.settled) {
      return {
        status: "failed",
        blocker:
          settle.status >= 200 && settle.status < 300
            ? "x402_facilitator_settlement_not_verified"
            : "x402_facilitator_settle_failed",
        signed_payload_hash: signed.signed_payload_hash,
        response_status: settle.status,
        casper_transaction_hash: null,
        receipt_json:
          settlement.receipt_json ??
          settlementReceiptJson({
            status: "settle_failed",
            payment_id: input.payment_id,
            selected_requirement_hash: input.selected_requirement_hash,
            facilitator_url: input.facilitator_url,
            settle_response: settle.body
          })
      };
    }

    return {
      status: "settled",
      signed_payload_hash: signed.signed_payload_hash,
      response_status: settle.status,
      casper_transaction_hash: settlement.transaction_hash,
      receipt_json: settlement.receipt_json
    };
  }
}

export function createSignedPayloadHash(payload: unknown): string {
  return sha256Hex(canonicalizeJson(payload));
}

function facilitatorEndpoint(facilitatorUrl: string | null, path: "verify" | "settle"): string {
  if (!facilitatorUrl) {
    throw new Error("X402_FACILITATOR_URL is required for facilitator settlement");
  }

  return new URL(path, ensureTrailingSlash(facilitatorUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function settlementReceiptJson(value: unknown): string {
  return JSON.stringify(redactX402Value(toJsonValue(value, "x402_settlement_receipt")));
}

async function postJsonWithFetch(url: string, body: JsonObject): Promise<X402JsonPostResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? parseJsonOrRaw(text) : {}
  };
}

function tryJsonObject(value: unknown): JsonObject | null {
  try {
    return toJsonObject(value, "x402_response");
  } catch {
    return null;
  }
}

function parseJsonOrRaw(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}
