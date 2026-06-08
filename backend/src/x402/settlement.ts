import { spawn } from "node:child_process";
import {
  extractCasperTransactionHash,
  type CasperCommandInvocation,
  type CasperCommandResult,
  type CasperCommandRunner
} from "../casper/anchorClient.js";
import { mapCasperClientSecretKeyArgs } from "../casper/paths.js";
import { canonicalizeJson, toJsonObject, toJsonValue } from "../memory/canonical.js";
import type { JsonObject } from "../memory/types.js";
import { sha256Hex } from "../memory/hash.js";
import { networkMatches } from "./normalization.js";
import { redactX402Value } from "./redaction.js";
import { validateX402PaymentPayload, verifyX402SettlementResponse } from "./readiness.js";
import {
  loadCasperSigningKeyFromFile,
  signX402PaymentPayload
} from "./signer.js";

export type X402SettlementBlocker =
  | "x402_settlement_disabled"
  | "x402_settlement_provider_unavailable"
  | "x402_signing_provider_not_configured"
  | "x402_signer_request_failed"
  | "x402_signer_response_invalid"
  | "x402_facilitator_verify_failed"
  | "x402_facilitator_settle_failed"
  | "x402_facilitator_settlement_not_verified"
  | "x402_paid_resource_fetch_failed"
  | "x402_paid_resource_still_requires_payment"
  | "x402_paid_resource_settlement_not_verified"
  | "x402_casper_settlement_not_configured"
  | "x402_casper_transaction_submission_disabled"
  | "x402_casper_payment_payload_invalid"
  | "x402_casper_transaction_submission_failed"
  | "x402_casper_transaction_hash_missing"
  | "x402_casper_transaction_lookup_failed"
  | "x402_casper_transaction_execution_unavailable"
  | "x402_casper_transaction_execution_failed";

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

export type X402HttpSigningProviderConfig = {
  signerUrl: string | null;
  authToken?: string | null;
  timeoutMs?: number;
  now?: () => Date;
  maxValiditySeconds?: number | null;
};

export type X402ResourceRetrySettlementConfig = {
  paymentHeaderName?: string;
  now?: () => Date;
  maxValiditySeconds?: number | null;
};

export type X402ResourceFetchResult = {
  status: number;
  headers: Headers;
  bodyText: string;
};

export type X402ResourceFetcher = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
  }
) => Promise<X402ResourceFetchResult>;

export type X402CasperCliSettlementConfig = {
  networkName: string;
  caip2ChainId: string;
  rpcUrl: string | null;
  accountKeyPath: string | null;
  submissionEnabled: boolean;
  clientBin: string;
  clientWslDistro: string | null;
  gasPriceTolerance: string;
  pricingMode: string;
  paymentAmountMotes: string;
  confirmationPollIntervalMs?: number;
  confirmationTimeoutMs?: number;
  now?: () => Date;
  maxValiditySeconds?: number | null;
};

export type ValidatedX402CasperCliSettlementConfig = X402CasperCliSettlementConfig & {
  rpcUrl: string;
  accountKeyPath: string;
};

export type CasperX402SettlementPayment =
  | {
      settlementKind: "native-transfer";
      scheme: "exact";
      network: string;
      assetId: "casper-native-cspr";
      target: string;
      amount: string;
      nonce: string;
    }
  | {
      settlementKind: "cep18-transfer-with-authorization";
      scheme: "exact";
      network: string;
      assetPackageHash: string;
      from: string;
      to: string;
      amount: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
      publicKey: string;
      signature: string;
    };

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

export type LocalCasperX402SigningProviderConfig = {
  accountKeyPath: string;
  buyerAccountHash: string | null;
};

export class LocalCasperX402SigningProvider implements X402SignedPaymentProvider {
  constructor(private readonly config: LocalCasperX402SigningProviderConfig) {}

  async sign(input: X402SigningInput): Promise<X402SigningResult> {
    let signingKey: ReturnType<typeof loadCasperSigningKeyFromFile>;
    try {
      signingKey = loadCasperSigningKeyFromFile(this.config.accountKeyPath);
    } catch {
      return { signed: false, blocker: "x402_signing_provider_not_configured" };
    }

    // Ed25519 publicKey is `01<32-byte-hex>` — accepted directly as account identifier
    const buyerAccountHash =
      this.config.buyerAccountHash ??
      (signingKey.algorithm === "ed25519" ? signingKey.publicKey : null);

    if (!buyerAccountHash) {
      return { signed: false, blocker: "x402_signing_provider_not_configured" };
    }

    const result = signX402PaymentPayload(
      {
        payment_id: input.payment_id,
        facilitator_url: input.facilitator_url,
        method: input.method,
        url: input.url,
        selected_requirement: input.selected_requirement,
        selected_requirement_hash: input.selected_requirement_hash,
        policy_hash: input.policy_hash
      },
      { signingKey, buyerAccountHash }
    );

    if (!result.signed) {
      return { signed: false, blocker: "x402_signer_response_invalid" };
    }

    return {
      signed: true,
      signed_payload: result.signed_payload,
      signed_payload_hash: createSignedPayloadHash(result.signed_payload)
    };
  }
}

export class HttpX402SigningProvider implements X402SignedPaymentProvider {
  constructor(private readonly config: X402HttpSigningProviderConfig) {}

  async sign(input: X402SigningInput): Promise<X402SigningResult> {
    if (!this.config.signerUrl) {
      return {
        signed: false,
        blocker: "x402_signing_provider_not_configured"
      };
    }

    let response: Response;
    try {
      response = await postSignerJson(this.config, {
        payment_id: input.payment_id,
        facilitator_url: input.facilitator_url,
        method: input.method,
        url: input.url,
        selected_requirement: input.selected_requirement,
        selected_requirement_hash: input.selected_requirement_hash,
        policy_hash: input.policy_hash
      });
    } catch {
      return {
        signed: false,
        blocker: "x402_signer_request_failed"
      };
    }

    const text = await response.text();
    if (!response.ok) {
      return {
        signed: false,
        blocker: "x402_signer_request_failed"
      };
    }

    const body = parseJsonOrRaw(text);
    const signedPayload = extractSignedPayload(body);
    if (!signedPayload) {
      return {
        signed: false,
        blocker: "x402_signer_response_invalid"
      };
    }
    const payloadApproval = validateX402PaymentPayload(
      signedPayload,
      input.selected_requirement_hash,
      {
        now: this.config.now?.() ?? new Date(),
        maxValiditySeconds: this.config.maxValiditySeconds ?? null
      }
    );
    if (!payloadApproval.approved) {
      return {
        signed: false,
        blocker: "x402_signer_response_invalid"
      };
    }

    return {
      signed: true,
      signed_payload: signedPayload,
      signed_payload_hash: createSignedPayloadHash(signedPayload)
    };
  }
}

export class CasperCliX402SettlementProvider implements X402SettlementProvider {
  constructor(
    private readonly signer: X402SignedPaymentProvider,
    private readonly config: X402CasperCliSettlementConfig,
    private readonly commandRunner: CasperCommandRunner = runCasperCommand
  ) {}

  async settle(input: X402SettlementInput): Promise<X402SettlementOutcome> {
    const config = validateX402CasperCliSettlementConfig(this.config);
    if (!config) {
      return {
        status: "unavailable",
        blocker: "x402_casper_settlement_not_configured",
        signed_payload_hash: null,
        response_status: null,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "settlement_unavailable",
          blocker: "x402_casper_settlement_not_configured",
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url
        })
      };
    }

    if (!config.submissionEnabled) {
      return {
        status: "unavailable",
        blocker: "x402_casper_transaction_submission_disabled",
        signed_payload_hash: null,
        response_status: null,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "settlement_unavailable",
          blocker: "x402_casper_transaction_submission_disabled",
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url
        })
      };
    }

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

    const payloadApproval = validateX402PaymentPayload(
      signed.signed_payload,
      input.selected_requirement_hash,
      {
        now: config.now?.() ?? new Date(),
        maxValiditySeconds: config.maxValiditySeconds ?? null
      }
    );
    if (!payloadApproval.approved) {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_payment_payload_invalid",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash: null,
        receipt: {
          status: "casper_payment_payload_invalid",
          reason: payloadApproval.reason
        }
      });
    }

    const payment = extractCasperSettlementPayment(
      signed.signed_payload,
      input.selected_requirement,
      input.selected_requirement_hash,
      config
    );
    if (!payment) {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_payment_payload_invalid",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash: null,
        receipt: {
          status: "casper_payment_payload_invalid"
        }
      });
    }

    const invocation = buildCasperX402SettlementCommand(config, payment);
    let putResult: CasperCommandResult;
    try {
      putResult = await this.commandRunner(invocation.command, invocation.args);
    } catch {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_transaction_submission_failed",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash: null,
        receipt: {
          status: "casper_transaction_submission_failed",
          command: commandReceipt(invocation)
        }
      });
    }

    if (putResult.exitCode !== 0) {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_transaction_submission_failed",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash: null,
        receipt: {
          status: "casper_transaction_submission_failed",
          command: commandReceipt(invocation),
          result: commandResultReceipt(putResult)
        }
      });
    }

    const transactionHash = extractCasperTransactionHash(putResult);
    if (!transactionHash) {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_transaction_hash_missing",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash: null,
        receipt: {
          status: "casper_transaction_hash_missing",
          command: commandReceipt(invocation),
          result: commandResultReceipt(putResult)
        }
      });
    }

    const execution = await this.waitForExecution(config, transactionHash);
    if (execution.status === "lookup_failed") {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_transaction_lookup_failed",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash,
        receipt: {
          status: "casper_transaction_lookup_failed",
          transactionHash,
          result: commandResultReceipt(execution.result)
        }
      });
    }

    if (execution.status === "not_executed") {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_transaction_execution_unavailable",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash,
        receipt: {
          status: "casper_transaction_execution_unavailable",
          transactionHash,
          receipt: execution.receipt
        }
      });
    }

    if (execution.status === "failed") {
      return casperSettlementFailedOutcome({
        input,
        blocker: "x402_casper_transaction_execution_failed",
        signedPayloadHash: signed.signed_payload_hash,
        transactionHash,
        receipt: {
          status: "casper_transaction_execution_failed",
          transactionHash,
          error_message: execution.errorMessage,
          receipt: execution.receipt
        }
      });
    }

    return {
      status: "settled",
      signed_payload_hash: signed.signed_payload_hash,
      response_status: 200,
      casper_transaction_hash: transactionHash,
      receipt_json: settlementReceiptJson({
        success: true,
        status: "settled",
        transactionHash,
        transaction: transactionHash,
        network: payment.network,
        asset: settlementAssetReceipt(payment),
        amount: payment.amount,
        payer: settlementPayerReceipt(payment, signed.signed_payload),
        payTo: settlementPayeeReceipt(payment),
        payment_id: input.payment_id,
        selected_requirement_hash: input.selected_requirement_hash,
        nonce_hash: sha256Hex(payment.nonce),
        execution: execution.receipt
      })
    };
  }

  private async waitForExecution(
    config: ValidatedX402CasperCliSettlementConfig,
    transactionHash: string
  ): Promise<CasperX402ExecutionStatus> {
    const timeoutMs = config.confirmationTimeoutMs ?? 120_000;
    const pollIntervalMs = config.confirmationPollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const invocation = buildCasperGetTransactionCommand(config, transactionHash);
      let result: CasperCommandResult;
      try {
        result = await this.commandRunner(invocation.command, invocation.args);
      } catch {
        return {
          status: "lookup_failed",
          result: { exitCode: 1, stdout: "", stderr: "casper-client get-transaction failed" }
        };
      }

      if (result.exitCode !== 0) {
        return { status: "lookup_failed", result };
      }

      const execution = verifyCasperTransactionExecution(result);
      if (execution.status !== "not_executed") {
        return execution;
      }

      if (Date.now() >= deadline) {
        return execution;
      }

      await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
  }
}

export class FacilitatorX402SettlementProvider implements X402SettlementProvider {
  constructor(
    private readonly signer: X402SignedPaymentProvider,
    private readonly postJson: X402JsonPoster = postJsonWithFetch,
    private readonly config: {
      now?: () => Date;
      maxValiditySeconds?: number | null;
    } = {}
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
    const payloadApproval = validateX402PaymentPayload(
      signed.signed_payload,
      input.selected_requirement_hash,
      {
        now: this.config.now?.() ?? new Date(),
        maxValiditySeconds: this.config.maxValiditySeconds ?? null
      }
    );
    if (!payloadApproval.approved) {
      return signerPayloadInvalidOutcome(input);
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
    const settlement = verifyX402SettlementResponse(settle.body, {
      selectedRequirement: input.selected_requirement,
      signedPayload: signed.signed_payload
    });
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

export class ResourceRetryX402SettlementProvider implements X402SettlementProvider {
  private readonly paymentHeaderName: string;
  private readonly now: () => Date;
  private readonly maxValiditySeconds: number | null;

  constructor(
    private readonly signer: X402SignedPaymentProvider,
    private readonly resourceFetch: X402ResourceFetcher = fetchPaidResource,
    config: X402ResourceRetrySettlementConfig = {}
  ) {
    this.paymentHeaderName = config.paymentHeaderName ?? "PAYMENT-SIGNATURE";
    this.now = config.now ?? (() => new Date());
    this.maxValiditySeconds = config.maxValiditySeconds ?? null;
  }

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
    const payloadApproval = validateX402PaymentPayload(
      signed.signed_payload,
      input.selected_requirement_hash,
      {
        now: this.now(),
        maxValiditySeconds: this.maxValiditySeconds
      }
    );
    if (!payloadApproval.approved) {
      return signerPayloadInvalidOutcome(input);
    }

    const paymentHeader = encodePaymentHeader(signed.signed_payload);
    let paidResponse: X402ResourceFetchResult;
    try {
      paidResponse = await this.resourceFetch(input.url, {
        method: input.method,
        headers: {
          [this.paymentHeaderName]: paymentHeader
        }
      });
    } catch {
      return {
        status: "failed",
        blocker: "x402_paid_resource_fetch_failed",
        signed_payload_hash: signed.signed_payload_hash,
        response_status: null,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "paid_resource_fetch_failed",
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url
        })
      };
    }

    const paymentResponse = parsePaymentResponseHeader(paidResponse.headers);
    const settlement = verifyX402SettlementResponse(paymentResponse, {
      selectedRequirement: input.selected_requirement,
      signedPayload: signed.signed_payload
    });
    const bodyHash = sha256Hex(paidResponse.bodyText);
    if (!paidResponseOk(paidResponse.status)) {
      return {
        status: "failed",
        blocker:
          paidResponse.status === 402
            ? "x402_paid_resource_still_requires_payment"
            : "x402_paid_resource_fetch_failed",
        signed_payload_hash: signed.signed_payload_hash,
        response_status: paidResponse.status,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "paid_resource_failed",
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url,
          resource_response_status: paidResponse.status,
          resource_response_hash: bodyHash,
          payment_response: paymentResponse
        })
      };
    }

    if (!settlement.settled) {
      return {
        status: "failed",
        blocker: "x402_paid_resource_settlement_not_verified",
        signed_payload_hash: signed.signed_payload_hash,
        response_status: paidResponse.status,
        casper_transaction_hash: null,
        receipt_json: settlementReceiptJson({
          status: "paid_resource_settlement_not_verified",
          reason: settlement.reason,
          payment_id: input.payment_id,
          selected_requirement_hash: input.selected_requirement_hash,
          facilitator_url: input.facilitator_url,
          resource_response_status: paidResponse.status,
          resource_response_hash: bodyHash,
          payment_response: paymentResponse
        })
      };
    }

    return {
      status: "settled",
      signed_payload_hash: signed.signed_payload_hash,
      response_status: paidResponse.status,
      casper_transaction_hash: settlement.transaction_hash,
      receipt_json: settlementReceiptJson({
        status: "settled",
        payment_id: input.payment_id,
        selected_requirement_hash: input.selected_requirement_hash,
        facilitator_url: input.facilitator_url,
        resource_response_status: paidResponse.status,
        resource_response_hash: bodyHash,
        payment_response: JSON.parse(settlement.receipt_json)
      })
    };
  }
}

export function createSignedPayloadHash(payload: unknown): string {
  return sha256Hex(canonicalizeJson(payload));
}

export function validateX402CasperCliSettlementConfig(
  config: X402CasperCliSettlementConfig
): ValidatedX402CasperCliSettlementConfig | null {
  if (!config.rpcUrl || !config.accountKeyPath) {
    return null;
  }

  return {
    ...config,
    rpcUrl: config.rpcUrl,
    accountKeyPath: config.accountKeyPath
  };
}

export function buildCasperX402SettlementCommand(
  config: ValidatedX402CasperCliSettlementConfig,
  payment: CasperX402SettlementPayment
): CasperCommandInvocation {
  if (payment.settlementKind === "native-transfer") {
    return wrapCasperX402Command(config, [
      "put-transaction",
      "transfer",
      "--node-address",
      config.rpcUrl,
      "--chain-name",
      config.networkName,
      "--secret-key",
      config.accountKeyPath,
      "--target",
      payment.target,
      "--transfer-amount",
      payment.amount,
      "--gas-price-tolerance",
      config.gasPriceTolerance,
      "--pricing-mode",
      config.pricingMode,
      "--payment-amount",
      config.paymentAmountMotes,
      "--standard-payment",
      "true"
    ]);
  }

  return wrapCasperX402Command(config, [
    "put-transaction",
    "package",
    "--node-address",
    config.rpcUrl,
    "--chain-name",
    config.networkName,
    "--contract-package-hash",
    `hash-${payment.assetPackageHash}`,
    "--session-entry-point",
    "transfer_with_authorization",
    "--gas-price-tolerance",
    config.gasPriceTolerance,
    "--pricing-mode",
    config.pricingMode,
    "--payment-amount",
    config.paymentAmountMotes,
    "--standard-payment",
    "true",
    "--secret-key",
    config.accountKeyPath,
    "--session-arg",
    sessionArg("from", "key", accountKeyArg(payment.from)),
    "--session-arg",
    sessionArg("to", "key", accountKeyArg(payment.to)),
    "--session-arg",
    sessionArg("amount", "u256", payment.amount),
    "--session-arg",
    sessionArg("valid_after", "i64", payment.validAfter),
    "--session-arg",
    sessionArg("valid_before", "i64", payment.validBefore),
    "--session-arg",
    sessionArg("nonce", "byte_array", payment.nonce),
    "--session-arg",
    sessionArg("public_key", "public_key", payment.publicKey),
    "--session-arg",
    sessionArg("signature", "byte_array", payment.signature)
  ]);
}

export function buildCasperGetTransactionCommand(
  config: ValidatedX402CasperCliSettlementConfig,
  transactionHash: string
): CasperCommandInvocation {
  return wrapCasperX402Command(config, [
    "get-transaction",
    "--node-address",
    config.rpcUrl,
    transactionHash
  ]);
}

export function verifyCasperTransactionExecution(
  result: CasperCommandResult
): CasperX402ExecutionStatus {
  const parsed = parseCasperClientOutput(result.stdout) ?? parseCasperClientOutput(result.stderr);
  const receipt = parsed ?? { raw: [result.stdout, result.stderr].filter(Boolean).join("\n") };
  const executionInfo = findExecutionInfo(receipt);

  if (!executionInfo) {
    return {
      status: "not_executed",
      receipt
    };
  }

  const errorMessage = findExecutionErrorMessage(executionInfo);
  if (errorMessage) {
    return {
      status: "failed",
      errorMessage,
      receipt
    };
  }

  return {
    status: "success",
    receipt
  };
}

type CasperX402ExecutionStatus =
  | {
      status: "success";
      receipt: unknown;
    }
  | {
      status: "failed";
      errorMessage: string;
      receipt: unknown;
    }
  | {
      status: "not_executed";
      receipt: unknown;
    }
  | {
      status: "lookup_failed";
      result: CasperCommandResult;
    };

type CasperSettlementFailureInput = {
  input: X402SettlementInput;
  blocker: X402SettlementBlocker;
  signedPayloadHash: string | null;
  transactionHash: string | null;
  receipt: unknown;
};

function casperSettlementFailedOutcome(
  failure: CasperSettlementFailureInput
): X402SettlementOutcome {
  return {
    status: "failed",
    blocker: failure.blocker,
    signed_payload_hash: failure.signedPayloadHash,
    response_status: null,
    casper_transaction_hash: failure.transactionHash,
    receipt_json: settlementReceiptJson({
      payment_id: failure.input.payment_id,
      selected_requirement_hash: failure.input.selected_requirement_hash,
      facilitator_url: failure.input.facilitator_url,
      ...(asRecord(failure.receipt) ?? {})
    })
  };
}

function signerPayloadInvalidOutcome(input: X402SettlementInput): X402SettlementOutcome {
  return {
    status: "unavailable",
    blocker: "x402_signer_response_invalid",
    signed_payload_hash: null,
    response_status: null,
    casper_transaction_hash: null,
    receipt_json: settlementReceiptJson({
      status: "settlement_unavailable",
      blocker: "x402_signer_response_invalid",
      payment_id: input.payment_id,
      selected_requirement_hash: input.selected_requirement_hash,
      facilitator_url: input.facilitator_url
    })
  };
}

function extractCasperSettlementPayment(
  signedPayload: JsonObject,
  selectedRequirement: JsonObject,
  selectedRequirementHash: string,
  config: ValidatedX402CasperCliSettlementConfig
): CasperX402SettlementPayment | null {
  const root = asRecord(signedPayload);
  if (!root) {
    return null;
  }

  const paymentPayload = asRecord(root.payload) ?? root;
  const authorization =
    asRecord(paymentPayload.authorization) ?? asRecord(root.authorization);
  if (!authorization) {
    return null;
  }

  const acceptedRequirement = asRecord(root.accepted);
  const scheme = firstString(root, ["scheme"]) ?? firstString(acceptedRequirement, ["scheme"]);
  if (scheme !== "exact") {
    return null;
  }

  const network =
    firstString(root, ["network"]) ??
    firstString(acceptedRequirement, ["network"]) ??
    firstString(selectedRequirement, ["network", "networkId", "network_id", "caip2_chain_id"]);
  if (!network || !networkMatches(network, config.caip2ChainId)) {
    return null;
  }

  const requirementNetwork = firstString(selectedRequirement, [
    "network",
    "networkId",
    "network_id",
    "caip2_chain_id"
  ]);
  if (requirementNetwork && !networkMatches(network, requirementNetwork)) {
    return null;
  }

  const payloadRequirementHash = firstString(root, [
    "selectedRequirementHash",
    "selected_requirement_hash"
  ]);
  if (payloadRequirementHash !== selectedRequirementHash) {
    return null;
  }

  const requirementAmount = firstString(selectedRequirement, [
    "amount",
    "maxAmountRequired",
    "max_amount_required"
  ]);
  if (!requirementAmount || !isUnsignedIntegerString(requirementAmount)) {
    return null;
  }

  const assetValue = firstString(selectedRequirement, [
    "asset",
    "assetId",
    "asset_id",
    "assetPackage",
    "asset_package"
  ]);
  const nonce = normalizeHex(
    firstString(authorization, ["nonce"]) ?? firstString(root, ["nonce"]),
    64
  );
  if (!nonce) {
    return null;
  }

  if (assetValue?.toLowerCase() === "casper-native-cspr") {
    const target = normalizeCasperTransferTarget(
      firstString(selectedRequirement, ["payTo", "pay_to", "payee", "recipient"])
    );
    if (!target) {
      return null;
    }

    return {
      settlementKind: "native-transfer",
      scheme: "exact",
      network,
      assetId: "casper-native-cspr",
      target,
      amount: requirementAmount,
      nonce
    };
  }

  const assetPackageHash = normalizeCasperPackageHash(assetValue);
  if (!assetPackageHash) {
    return null;
  }

  const from = normalizeCasperAccountAddress(firstString(authorization, ["from"]));
  const to = normalizeCasperAccountAddress(firstString(authorization, ["to"]));
  const amount = firstString(authorization, ["value", "amount"]);
  const validAfter = unixSecondsString(
    firstString(authorization, ["validAfter", "valid_after"])
  );
  const validBefore = unixSecondsString(
    firstString(authorization, ["validBefore", "valid_before"])
  );
  const publicKey = normalizePublicKey(
    firstString(paymentPayload, ["publicKey", "public_key"]) ??
      firstString(authorization, ["publicKey", "public_key"])
  );
  const signature = normalizeHex(
    firstString(paymentPayload, ["signature"]) ?? firstString(authorization, ["signature"]),
    130
  );

  if (
    !from ||
    !to ||
    !amount ||
    !isUnsignedIntegerString(amount) ||
    !validAfter ||
    !validBefore ||
    !nonce ||
    !publicKey ||
    !signature
  ) {
    return null;
  }

  if (BigInt(validBefore) <= BigInt(validAfter)) {
    return null;
  }

  const nowSeconds = BigInt(Math.floor((config.now?.() ?? new Date()).getTime() / 1000));
  if (BigInt(validAfter) > nowSeconds) {
    return null;
  }
  if (BigInt(validBefore) <= nowSeconds) {
    return null;
  }

  const payer = normalizeCasperAccountAddress(
    firstString(root, ["payer", "payerAccount", "payer_account"])
  );
  if (payer && payer !== from) {
    return null;
  }

  if (requirementAmount && requirementAmount !== amount) {
    return null;
  }

  const requirementPayTo = normalizeCasperAccountAddress(
    firstString(selectedRequirement, ["payTo", "pay_to", "payee", "recipient"])
  );
  if (requirementPayTo && requirementPayTo !== to) {
    return null;
  }

  return {
    settlementKind: "cep18-transfer-with-authorization",
    scheme: "exact",
    network,
    assetPackageHash,
    from,
    to,
    amount,
    validAfter,
    validBefore,
    nonce,
    publicKey,
    signature
  };
}

function runCasperCommand(command: string, args: readonly string[]): Promise<CasperCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

function wrapCasperX402Command(
  config: ValidatedX402CasperCliSettlementConfig,
  args: string[]
): CasperCommandInvocation {
  if (!config.clientWslDistro) {
    return {
      command: config.clientBin,
      args
    };
  }

  return {
    command: "wsl",
    args: [
      "-d",
      config.clientWslDistro,
      "--",
      config.clientBin,
      ...mapCasperClientSecretKeyArgs(args, config.clientWslDistro)
    ]
  };
}

function sessionArg(name: string, type: string, value: string): string {
  return `${name}:${type}='${value}'`;
}

function accountKeyArg(value: string): string {
  const normalized = normalizeCasperAccountAddress(value);
  if (!normalized) {
    throw new Error("Invalid Casper account address");
  }

  return `account-hash-${normalized.slice(2)}`;
}

function commandReceipt(invocation: CasperCommandInvocation): JsonObject {
  return {
    command: invocation.command,
    args: invocation.args.map((arg, index) =>
      redactCommandArg(arg, invocation.args[index - 1] ?? null)
    )
  };
}

function redactCommandArg(arg: string, previousArg: string | null): string {
  if (previousArg === "--secret-key") {
    return "<redacted>";
  }

  if (previousArg !== "--session-arg") {
    return arg;
  }

  const sessionArgMatch = arg.match(/^([^:]+):([^=]+)='(.*)'$/);
  if (!sessionArgMatch) {
    return arg;
  }

  const [, name, type, value] = sessionArgMatch;
  if (!name || !type) {
    return arg;
  }

  if (/signature|public_key|private_key|secret|authorization|nonce/i.test(name)) {
    return `${name}:${type}='<redacted:${sha256Hex(value ?? "")}>'`;
  }

  return arg;
}

function commandResultReceipt(result: CasperCommandResult): JsonObject {
  return {
    exit_code: result.exitCode,
    stdout_hash: result.stdout ? sha256Hex(result.stdout) : null,
    stderr_hash: result.stderr ? sha256Hex(result.stderr) : null,
    stdout_bytes: Buffer.byteLength(result.stdout, "utf8"),
    stderr_bytes: Buffer.byteLength(result.stderr, "utf8")
  };
}

function parseCasperClientOutput(output: string): unknown | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  for (const candidate of [trimmed, jsonObjectSlice(trimmed)]) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }

  return null;
}

function jsonObjectSlice(output: string): string | null {
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return output.slice(firstBrace, lastBrace + 1);
}

function findExecutionInfo(value: unknown): unknown | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["execution_info", "execution_results"]) {
    const executionInfo = record[key];
    if (Array.isArray(executionInfo)) {
      if (executionInfo.length > 0) {
        return executionInfo;
      }
      continue;
    }

    if (executionInfo && typeof executionInfo === "object") {
      return executionInfo;
    }
  }

  for (const nested of Object.values(record)) {
    const executionInfo = findExecutionInfo(nested);
    if (executionInfo) {
      return executionInfo;
    }
  }

  return null;
}

function findExecutionErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const errorMessage = findExecutionErrorMessage(item);
      if (errorMessage) {
        return errorMessage;
      }
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const direct = record.error_message;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const failure = record.Failure ?? record.failure;
  if (failure) {
    return typeof failure === "string" ? failure : JSON.stringify(failure);
  }

  for (const nested of Object.values(record)) {
    const errorMessage = findExecutionErrorMessage(nested);
    if (errorMessage) {
      return errorMessage;
    }
  }

  return null;
}

function firstString(
  record: Record<string, unknown> | JsonObject | null | undefined,
  keys: string[]
): string | null {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeCasperPackageHash(value: string | null): string | null {
  const normalized = value?.toLowerCase().replace(/^(hash-|package-)/, "");

  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeCasperAccountAddress(value: string | null): string | null {
  const normalized = value?.toLowerCase();
  if (!normalized) {
    return null;
  }

  const accountHash = normalized.match(/^account-hash-([a-f0-9]{64})$/);
  if (accountHash) {
    return `00${accountHash[1]}`;
  }

  return /^(00|01)[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeHex(value: string | null, length: number): string | null {
  const normalized = value?.toLowerCase().replace(/^0x/, "");

  return normalized && new RegExp(`^[a-f0-9]{${length}}$`).test(normalized)
    ? normalized
    : null;
}

function normalizePublicKey(value: string | null): string | null {
  const normalized = value?.toLowerCase().replace(/^0x/, "");
  if (!normalized || !/^(01|02)[a-f0-9]+$/.test(normalized)) {
    return null;
  }

  return normalized.length === 66 || normalized.length === 68 ? normalized : null;
}

function normalizeCasperTransferTarget(value: string | null): string | null {
  const publicKey = normalizePublicKey(value);
  if (publicKey) {
    return publicKey;
  }

  const accountAddress = normalizeCasperAccountAddress(value);
  return accountAddress ? `account-hash-${accountAddress.slice(2)}` : null;
}

function settlementAssetReceipt(payment: CasperX402SettlementPayment): string {
  return payment.settlementKind === "native-transfer"
    ? payment.assetId
    : payment.assetPackageHash;
}

function settlementPayeeReceipt(payment: CasperX402SettlementPayment): string {
  return payment.settlementKind === "native-transfer" ? payment.target : payment.to;
}

function settlementPayerReceipt(
  payment: CasperX402SettlementPayment,
  signedPayload: JsonObject
): string | null {
  if (payment.settlementKind !== "native-transfer") {
    return payment.from;
  }

  return firstString(signedPayload, ["payer", "payerAccount", "payer_account"]);
}

function unixSecondsString(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (isUnsignedIntegerString(value)) {
    return value;
  }

  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return String(Math.floor(timestampMs / 1000));
}

function isUnsignedIntegerString(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function postSignerJson(
  config: X402HttpSigningProviderConfig,
  body: JsonObject
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    if (config.authToken) {
      headers.authorization = `Bearer ${config.authToken}`;
    }

    return await fetch(config.signerUrl!, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractSignedPayload(value: unknown): JsonObject | null {
  const response = tryJsonObject(value);
  if (!response) {
    return null;
  }

  for (const key of [
    "signed_payload",
    "signedPayload",
    "paymentPayload",
    "payment_payload"
  ]) {
    const candidate = response[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return toJsonObject(candidate, key);
    }
  }

  return null;
}

function encodePaymentHeader(payload: JsonObject): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

async function fetchPaidResource(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
  }
): Promise<X402ResourceFetchResult> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers
  });

  return {
    status: response.status,
    headers: response.headers,
    bodyText: await response.text()
  };
}

function parsePaymentResponseHeader(headers: Headers): unknown {
  for (const name of ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"]) {
    const header = headers.get(name);
    if (!header) {
      continue;
    }

    return parsePaymentResponseHeaderValue(header);
  }

  return null;
}

function parsePaymentResponseHeaderValue(value: string): unknown {
  const trimmed = value.trim();
  for (const candidate of [
    () => Buffer.from(trimmed, "base64").toString("utf8"),
    () => trimmed
  ]) {
    try {
      return JSON.parse(candidate()) as unknown;
    } catch {
      continue;
    }
  }

  return { raw: trimmed };
}

function paidResponseOk(status: number): boolean {
  return status >= 200 && status < 300;
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
