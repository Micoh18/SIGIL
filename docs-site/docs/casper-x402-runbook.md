---
title: Casper x402 Runbook
description: Reproduce and verify real Casper testnet x402 settlement through payment.fetch, sidecars, and transaction hash verification.
section: Core Modules
status: settlement-ready
last_verified: 2026-06-06
---

# Casper x402 Runbook

This runbook proves real Casper x402 settlement through the MCP `payment.fetch`
tool. It is separate from the [Local Demo](/local-demo), which proves MCP tool
behavior and intentionally stops at `settlement=not_started`.

## What Success Proves

A passing run proves:

- The protected resource first returns `402 Payment Required`.
- `payment.fetch` approves captured x402 requirements against Grimoire policy
  before signing.
- The signer sidecar returns a signed x402 `PaymentPayload`; the MCP backend
  stores only `signed_payload_hash`.
- The paid retry sends `PAYMENT-SIGNATURE`.
- The resource calls facilitator `/verify` and `/settle`.
- The facilitator submits a Casper transaction and waits for successful
  execution.
- `payment.receipt` contains `settlement_status=settled` and a Casper
  transaction hash.
- Policy spend increases only after settlement.
- `audit.tail` includes `payment.challenge_received`, `payment.settled`, and
  `policy.spend_recorded`.

## Verified Testnet Run

The real native CSPR x402 smoke passed on Casper testnet on 2026-06-06 UTC.

```text
payment_id=pay_88263e4a93314ad3b8b1b27247d2ed8b
policy_id=pol-casper-x402-smoke-1780711240344
casper_transaction_hash=456ca636d8dd2e86268f8c1905055778753e41d95f411c827f3ecf97d215c4a4
settlement_status=settled
policy_spend=0 -> 2500000000
```

Manual `casper-client get-transaction` verification returned `execution_info`,
`error_message: null`, and no `Failure`. The transaction executed a native CSPR
transfer of `2500000000` motes at block height `8086501`.

## Prerequisites

From the repository root:

```bash
npm install --prefix backend
npm test --prefix backend
npm run build --prefix backend
casper-client --version
```

On Windows, set `CASPER_CLIENT_WSL_DISTRO=Ubuntu` if the facilitator should run
`casper-client` through WSL. Keep `X402_BUYER_PRIVATE_KEY_PATH` as a host path
readable by Node. The signer sidecar rejects private keys inside the repository.

## Required `.env`

Copy `.env.example`, generate a Grimoire key, then set:

```env
SIGIL_DATA_DIR=./.sigil
GRIMOIRE_MASTER_KEY=<base64-32-byte-key>

CASPER_NETWORK_NAME=casper-test
CASPER_CAIP2_CHAIN_ID=casper:casper-test
CASPER_RPC_URL=https://node.testnet.casper.network/rpc
CASPER_ACCOUNT_KEY_PATH=<absolute-path-outside-repo>/backend.pem
CASPER_ENABLE_REAL_SUBMISSION=true
CASPER_CLIENT_BIN=casper-client
CASPER_CLIENT_WSL_DISTRO=
CASPER_GAS_PRICE_TOLERANCE=10
CASPER_PRICING_MODE=classic

X402_ENABLE_REAL_SETTLEMENT=true
X402_SETTLEMENT_MODE=resource-retry
X402_FACILITATOR_URL=http://127.0.0.1:4022
X402_FACILITATOR_HOST=127.0.0.1
X402_FACILITATOR_PORT=4022
X402_RESOURCE_DEMO_URL=http://127.0.0.1:4021/weather
X402_RESOURCE_AMOUNT=2500000000
X402_RESOURCE_TIMEOUT_SECONDS=60
X402_ASSET_ID=casper-native-cspr
X402_ASSET_PACKAGE=
X402_ASSET_NAME=CSPR
X402_ASSET_DECIMALS=9
X402_AMOUNT_UNIT=mote
X402_PAYMENT_HEADER_NAME=PAYMENT-SIGNATURE
X402_CASPER_SETTLEMENT_PAYMENT_AMOUNT_MOTES=7000000000
X402_CASPER_CONFIRMATION_POLL_INTERVAL_MS=2000
X402_CASPER_CONFIRMATION_TIMEOUT_MS=120000

X402_BUYER_PUBLIC_KEY=0203ae31034f6ae830666153c3e4335a99fd5543b1306ba5e0423e9253c8a6b2392f
X402_BUYER_ACCOUNT_HASH=account-hash-d0a57c6a95e74463de156cac761e17f0923eafc730ce3ce3a0c747c6598b0500
X402_BUYER_PRIVATE_KEY_PATH=<absolute-path-outside-repo>/backend.pem
X402_PAYEE_PUBLIC_KEY=02032878c27882713870adf0e7546a082e991147824e77b710aaa77f47c6d972b041
X402_PAYEE_ACCOUNT_HASH=account-hash-c56b473b046198bdf8b7e266f1a4166b4300f2b13d69b6da71cd3feaf2979609
X402_PAY_TO=02032878c27882713870adf0e7546a082e991147824e77b710aaa77f47c6d972b041
X402_SIGNER_URL=http://127.0.0.1:4030/sign
X402_SIGNER_HOST=127.0.0.1
X402_SIGNER_PORT=4030
X402_SIGNER_AUTH_TOKEN=
X402_SIGNER_TIMEOUT_MS=10000
X402_SIGNER_MAX_VALIDITY_SECONDS=900
```

Native CSPR uses integer motes. `2500000000` is 2.5 CSPR.

## One-Command Smoke

```bash
npm run smoke:x402-payment-fetch --prefix backend
```

Expected output includes:

```text
x402 facilitator: http://127.0.0.1:4022
x402 signer: http://127.0.0.1:4030/sign
x402 paid resource: http://127.0.0.1:4021/weather
Mr Mainspring Casper x402 payment.fetch smoke
resource=http://127.0.0.1:4021/weather
policy_id=pol-casper-x402-smoke-<timestamp>
PASS payment.fetch: status=settled settlement=settled payment_id=pay_<hex>
PASS payment.receipt: settlement_status=settled casper_transaction_hash=<64-hex>
PASS policy.spend: before=0 after_preflight=0 after_settlement=2500000000
PASS audit.tail: events=payment.challenge_received,payment.settled,policy.spend_recorded
RESULT PASS
```

The smoke fails if no Casper transaction hash is present or if policy spend
changes before settlement.

## Manual Sidecars

Terminal 1:

```bash
npm run x402:facilitator --prefix backend
```

Expected:

```text
x402 facilitator sidecar: http://127.0.0.1:4022
x402 facilitator endpoints: POST /verify, POST /settle
Press Ctrl+C to stop.
```

Terminal 2:

```bash
npm run x402:signer --prefix backend
```

Expected:

```text
x402 signer sidecar: http://127.0.0.1:4030/sign
x402 signer key: secp256k1 public_key=<buyer-public-key>
Press Ctrl+C to stop.
```

Terminal 3:

```bash
npm run x402:resource --prefix backend
```

Expected:

```text
x402 paid resource: http://127.0.0.1:4021/weather
x402 facilitator:   http://127.0.0.1:4022
x402 payment header: PAYMENT-SIGNATURE
x402 mode: real-facilitator
Start the signer with `npm run x402:signer --prefix backend`.
Press Ctrl+C to stop.
```

Terminal 4:

```bash
X402_SMOKE_START_SIDECARS=false npm run smoke:x402-payment-fetch --prefix backend
```

PowerShell:

```powershell
$env:X402_SMOKE_START_SIDECARS = "false"
npm run smoke:x402-payment-fetch --prefix backend
```

## Transaction Hash Verification

Copy `casper_transaction_hash` from the smoke output.

```powershell
$tx = "<casper_transaction_hash>"
if ($tx -notmatch "^(hash-)?[a-f0-9]{64}$") { throw "bad transaction hash: $tx" }
"transaction_hash_format_ok=$tx"
```

Query Casper:

```bash
casper-client get-transaction \
  --node-address https://node.testnet.casper.network/rpc \
  <casper_transaction_hash>
```

Or through WSL:

```bash
wsl -d Ubuntu -- casper-client get-transaction \
  --node-address https://node.testnet.casper.network/rpc \
  <casper_transaction_hash>
```

Expected signals:

```text
execution_info=<present>
error_message=<absent or null>
Failure=<absent>
```

If `execution_info` is not present yet, wait and rerun `get-transaction`. If
`Failure` or `error_message` is present, the payment is not verified successful
on-chain and must not be reported as settled.

## Local Simulation

These commands are useful but do not prove on-chain settlement:

```bash
npm run demo:stdio --prefix backend
npm run demo:x402-sidecars:smoke --prefix backend
```

`demo:stdio` reports `settlement=not_started`.
`demo:x402-sidecars:smoke` without `X402_SIGNER_URL` checks only the initial
challenge.

## Failure States

Common precondition failures:

| Output | Meaning |
| --- | --- |
| `X402_ENABLE_REAL_SETTLEMENT must be true` | Real settlement is disabled. |
| `X402_SETTLEMENT_MODE must be resource-retry` | The full smoke requires paid resource retry. |
| `X402_SIGNER_URL is required` | No signer sidecar is configured. |
| `CASPER_ENABLE_REAL_SUBMISSION must be true` | Casper submission is gated off. |
| `CASPER_RPC_URL is required` | Facilitator cannot submit or verify. |
| `CASPER_ACCOUNT_KEY_PATH is required` | Facilitator has no funded account key. |
| `X402_BUYER_PRIVATE_KEY_PATH must point outside the repository workspace` | Signer refused a repo-local key. |

MCP blockers:

| Blocker | Meaning |
| --- | --- |
| `x402_settlement_disabled` | Real settlement is intentionally disabled. |
| `x402_signing_provider_not_configured` | Settlement is enabled but no signer is configured. |
| `x402_signer_request_failed` | Signer URL was unreachable, timed out, or returned non-2xx. |
| `x402_signer_response_invalid` | Signer payload was missing or did not match the selected requirement hash. |
| `x402_requirements_not_allowed` | Requirements did not match policy. |
| `x402_paid_resource_still_requires_payment` | Paid retry returned another 402. |
| `x402_paid_resource_settlement_not_verified` | `PAYMENT-RESPONSE` was missing or unverifiable. |
| `x402_casper_transaction_submission_disabled` | Facilitator reached settlement but submission was not enabled. |
| `x402_casper_transaction_submission_failed` | `casper-client put-transaction` failed. |
| `x402_casper_transaction_hash_missing` | Casper CLI output had no transaction hash. |
| `x402_casper_transaction_lookup_failed` | `casper-client get-transaction` failed. |
| `x402_casper_transaction_execution_unavailable` | Execution was not available before timeout. |
| `x402_casper_transaction_execution_failed` | Casper execution completed with a failure. |

Facilitator/resource failures:

| Response | Meaning |
| --- | --- |
| `400 invalid_json` | Request body was invalid JSON or too large. |
| `422 invalid_payment reason=<field>` | Payment fields did not validate, such as `network_mismatch`, `payee_mismatch`, or `signature_invalid`. |
| `409 payment_replayed` | Nonce or payload was already used. |
| `503 settlement_unavailable` | Facilitator validated payment but could not submit settlement. |
| `402 payment_verify_failed` | Resource `/verify` call rejected the payment. |
| `502 payment_settle_failed` | Resource `/settle` call failed. |
| `502 payment_settlement_not_verified` | Settlement response did not prove a transaction hash. |

## Verification Commands

```bash
npm run docs:llms --prefix docs-site
npm run build --prefix docs-site
npm test --prefix backend
npm run build --prefix backend
```
