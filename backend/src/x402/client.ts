import { sha256Hex } from "../memory/hash.js";

export type PaymentRequirements = unknown;

export type X402ChallengeClientConfig = {
  facilitatorUrl?: string | null;
  resourceUrl?: string | null;
};

export type X402ChallengeRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
};

export type X402RequirementsSource =
  | "payment-required-header"
  | "x-payment-required-header"
  | "json-body"
  | "raw-body";

type X402ChallengeMetadata = {
  facilitator_url: string | null;
  resource_url: string | null;
  request_url: string;
};

export type X402ChallengeResult =
  | {
      status: "payment_required";
      status_code: 402;
      requirements: PaymentRequirements;
      requirements_json: string;
      requirements_source: X402RequirementsSource;
      raw_body: string;
      settlement_status: "not_started";
    } & X402ChallengeMetadata
  | {
      status: "free_response";
      status_code: number;
      body_text: string;
      response_hash: string;
      settlement_status: "not_required";
    } & X402ChallengeMetadata
  | {
      status: "unexpected_response";
      status_code: number;
      body_text: string;
      response_hash: string;
      settlement_status: "not_started";
    } & X402ChallengeMetadata;

export class X402ChallengeClient {
  constructor(private readonly config: X402ChallengeClientConfig = {}) {}

  async requestChallenge(input: X402ChallengeRequest): Promise<X402ChallengeResult> {
    const response = await fetch(input.url, {
      method: input.method.toUpperCase(),
      headers: input.headers
    });
    const bodyText = await response.text();
    const metadata = this.metadata(input.url);

    if (response.status === 402) {
      const requirements = parseRequirements(response.headers, bodyText);
      return {
        ...metadata,
        status: "payment_required",
        status_code: 402,
        requirements: requirements.value,
        requirements_json: JSON.stringify(requirements.value),
        requirements_source: requirements.source,
        raw_body: bodyText,
        settlement_status: "not_started"
      };
    }

    if (response.ok) {
      return {
        ...metadata,
        status: "free_response",
        status_code: response.status,
        body_text: bodyText,
        response_hash: sha256Hex(bodyText),
        settlement_status: "not_required"
      };
    }

    return {
      ...metadata,
      status: "unexpected_response",
      status_code: response.status,
      body_text: bodyText,
      response_hash: sha256Hex(bodyText),
      settlement_status: "not_started"
    };
  }

  private metadata(requestUrl: string): X402ChallengeMetadata {
    return {
      facilitator_url: this.config.facilitatorUrl ?? null,
      resource_url: this.config.resourceUrl ?? requestUrl,
      request_url: requestUrl
    };
  }
}

type ParsedRequirements = {
  value: PaymentRequirements;
  source: X402RequirementsSource;
};

const PAYMENT_REQUIRED_HEADERS: Array<{ name: string; source: X402RequirementsSource }> = [
  { name: "PAYMENT-REQUIRED", source: "payment-required-header" },
  { name: "X-PAYMENT-REQUIRED", source: "x-payment-required-header" }
];

function parseRequirements(headers: Headers, bodyText: string): ParsedRequirements {
  for (const header of PAYMENT_REQUIRED_HEADERS) {
    const value = headers.get(header.name);
    if (!value) {
      continue;
    }

    const parsed = parseBase64Json(value);
    if (parsed.ok) {
      return { value: parsed.value, source: header.source };
    }
  }

  const parsedBody = parseJson(bodyText);
  if (parsedBody.ok) {
    return { value: parsedBody.value, source: "json-body" };
  }

  return { value: { raw: bodyText }, source: "raw-body" };
}

function parseBase64Json(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return parseJson(Buffer.from(value.trim(), "base64").toString("utf8"));
  } catch {
    return { ok: false };
  }
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  if (!value.trim()) {
    return { ok: false };
  }

  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}
