import { sha256Hex } from "../memory/hash.js";

export type X402ChallengeRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
};

export type X402ChallengeResult =
  | {
      status: "payment_required";
      status_code: 402;
      requirements: unknown;
      raw_body: string;
      settlement_status: "not_started";
    }
  | {
      status: "free_response";
      status_code: number;
      body_text: string;
      response_hash: string;
      settlement_status: "not_required";
    }
  | {
      status: "unexpected_response";
      status_code: number;
      body_text: string;
      response_hash: string;
      settlement_status: "not_started";
    };

export class X402ChallengeClient {
  async requestChallenge(input: X402ChallengeRequest): Promise<X402ChallengeResult> {
    const response = await fetch(input.url, {
      method: input.method.toUpperCase(),
      headers: input.headers
    });
    const bodyText = await response.text();

    if (response.status === 402) {
      return {
        status: "payment_required",
        status_code: 402,
        requirements: parseRequirements(bodyText),
        raw_body: bodyText,
        settlement_status: "not_started"
      };
    }

    if (response.ok) {
      return {
        status: "free_response",
        status_code: response.status,
        body_text: bodyText,
        response_hash: sha256Hex(bodyText),
        settlement_status: "not_required"
      };
    }

    return {
      status: "unexpected_response",
      status_code: response.status,
      body_text: bodyText,
      response_hash: sha256Hex(bodyText),
      settlement_status: "not_started"
    };
  }
}

function parseRequirements(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return { raw: bodyText };
  }
}
