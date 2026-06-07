---
title: Payments and x402
description: Durable payment intents, x402 challenge capture, requirement approval, external signing, paid retry, and verified settlement receipts.
section: Core Modules
status: settlement-ready
last_verified: 2026-06-06
---

# Payments and x402

The payment module is intentionally conservative. It creates durable payment intents, can request the first x402 challenge after Grimoire policy approval, validates captured payment requirements, and then enters an explicit settlement-provider boundary. By default that provider is disabled. When real settlement is enabled, the backend delegates signing to an external signer sidecar, retries the resource with `PAYMENT-SIGNATURE`, and marks `settled` only after a verified `PAYMENT-RESPONSE`.

For a reproducible real settlement flow, use the [Casper x402 Runbook](/casper-x402-runbook). The [Local Demo](/local-demo) is intentionally pre-settlement and must not be used as proof of on-chain payment. The latest real testnet smoke passed on 2026-06-06 UTC with transaction hash `456ca636d8dd2e86268f8c1905055778753e41d95f411c827f3ecf97d215c4a4`.

## Flow States

```text
created
policy_denied
policy_checked
challenge_received
settlement_unavailable
settled
```

`settled` is reserved for a provider result that genuinely verifies settlement. The default wiring still keeps settlement disabled. Real settlement requires a configured signer sidecar and a resource/facilitator pair that returns a verifiable settlement response with a transaction hash.

## Runnable Paths

| Path | Command | Proves | Does not prove |
| --- | --- | --- | --- |
| Local MCP simulation | `npm run demo:stdio --prefix backend` | MCP tool list, memory, Grimoire, policy approval, durable payment intent, receipt lookup, audit trail. | x402 signing, paid retry, facilitator settlement, Casper transaction hash. |
| Local x402 challenge | `npm run demo:x402-sidecars:smoke --prefix backend` without `X402_SIGNER_URL` | Paid resource returns `402 Payment Required` with x402 requirements. | Signed payment or settlement. |
| Real Casper x402 settlement | `npm run smoke:x402-payment-fetch --prefix backend` with the runbook env | `payment.fetch` challenge capture, requirement approval, signing, paid retry, facilitator `/verify` + `/settle`, Casper transaction hash, policy spend update, audit events. | Production key custody, external public facilitator support, memory-anchor finality query. |

## Official x402 Boundary

The official x402 flow is:

```text
initial resource request
402 Payment Required with PAYMENT-REQUIRED requirements
client selects an allowed requirement
client signs a PaymentPayload
client retries with PAYMENT-SIGNATURE
resource server verifies locally or through facilitator /verify
resource server settles locally or through facilitator /settle
resource server returns PAYMENT-RESPONSE settlement details
```

Mr Mainspring implements the client-side boundary up to verified paid retry:

```text
challenge capture
Grimoire policy approval
captured requirement approval against policy
current-period spend check
external signer sidecar request
retry resource with PAYMENT-SIGNATURE
verify PAYMENT-RESPONSE
persist receipt and update policy spend only after verified settlement
```

The exact backend boundary is:

| Boundary | Current status |
| --- | --- |
| Challenge capture | Implemented. The first HTTP request can capture `PAYMENT-REQUIRED`, `X-PAYMENT-REQUIRED`, JSON body requirements, or a raw body fallback. |
| Policy approval | Implemented before any challenge request. URL, method, and expected amount are checked against the Grimoire policy. |
| Requirement approval | Implemented after challenge capture and before any future signing. The selected requirement must match amount, resource URL, optional method, network, configured asset, configured payee, and configured scheme. |
| Period spend gate | Implemented before signing. The selected requirement amount plus current period spend must fit inside `max_amount_per_period`. |
| Payment payload signing | Implemented through `X402_SIGNER_URL`. The backend never reads a private key; it sends approved requirements to a signer sidecar and persists only the signed payload hash. |
| Paid resource retry | Implemented in `resource-retry` mode. The backend retries the original resource with a base64 JSON payment payload in `PAYMENT-SIGNATURE`. |
| `PAYMENT-RESPONSE` verification | Implemented. A paid 2xx response is not enough; the response must include a verifiable settlement object with a transaction hash. |
| Facilitator `/verify` + `/settle` | Available as `X402_SETTLEMENT_MODE=facilitator` for server-side/facilitator tests. Verify output alone never marks settlement. |
| Receipt persistence | Implemented for unavailable, failed, and settled provider outcomes. The default receipt is `settlement_unavailable`. |
| Spend accounting | Prechecked before signing and recorded after verified settlement. `current_period_spend` is not updated for challenge capture, failed signing, failed retry, or unavailable settlement. |

## `payment.fetch`

Default behavior checks policy and persists an intent:

```json
{
  "agent_id": "agent-demo-1",
  "policy_id": "pol_demo_weather",
  "method": "GET",
  "url": "http://localhost:4021/weather",
  "expected_amount": "0.01",
  "idempotency_key": "demo-weather-001"
}
```

Expected current result:

```json
{
  "allowed": true,
  "status": "policy_checked",
  "next_state": "challenge_received",
  "settlement": "not_started",
  "requirements_json": null
}
```

Set `request_challenge: true` to make the initial HTTP request:

```json
{
  "agent_id": "agent-demo-1",
  "policy_id": "pol_demo_weather",
  "method": "GET",
  "url": "http://localhost:4021/weather",
  "expected_amount": "0.01",
  "idempotency_key": "demo-weather-001",
  "request_challenge": true
}
```

If the resource returns HTTP 402, Mr Mainspring captures `PaymentRequirements` from a JSON body or standard x402 headers and persists `requirements_json`.

```json
{
  "allowed": true,
  "status": "settlement_unavailable",
  "settlement": "unavailable",
  "settlement_blocker": "x402_settlement_disabled",
  "challenge": {
    "status": "payment_required",
    "status_code": 402,
    "requirements_source": "json-body"
  }
}
```

With real settlement enabled and a signer sidecar configured:

```env
X402_ENABLE_REAL_SETTLEMENT=true
X402_SETTLEMENT_MODE=resource-retry
X402_SIGNER_URL=http://localhost:4030/sign
X402_PAYMENT_HEADER_NAME=PAYMENT-SIGNATURE
```

the same `payment.fetch` call performs:

```text
402 challenge -> policy-approved requirement -> signer sidecar -> paid retry -> PAYMENT-RESPONSE verification -> settled receipt
```

The signer sidecar receives:

```json
{
  "payment_id": "pay_...",
  "facilitator_url": "http://localhost:4022",
  "method": "GET",
  "url": "http://localhost:4021/weather",
  "selected_requirement": {},
  "selected_requirement_hash": "sha256-hex",
  "policy_hash": "sha256-hex"
}
```

and must return one of:

```json
{
  "signed_payload": {
    "x402Version": 2,
    "accepted": {},
    "payload": {}
  }
}
```

or:

```json
{
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {},
    "payload": {}
  }
}
```

The signed payload itself is never returned through MCP outputs. `payment.receipt` exposes only intent metadata, receipt metadata, and the signed payload hash.

If the selected requirement would exceed the current period budget, settlement stops before the signer sidecar is called:

```json
{
  "allowed": true,
  "status": "settlement_unavailable",
  "settlement": "unavailable",
  "settlement_blocker": "policy_period_limit_exceeded"
}
```

## Paid Resource Sidecar

For backend wiring tests, run the paid resource sidecar:

```bash
npm run demo:x402-sidecars --prefix backend
```

It starts:

```text
resource: http://localhost:4021/weather
```

The resource returns `402 Payment Required` plus `PAYMENT-REQUIRED` until the backend retries with `PAYMENT-SIGNATURE`. On a paid retry it calls the configured facilitator `/verify`; if verification passes it calls `/settle`; it returns the protected resource body and attaches `PAYMENT-RESPONSE` only after the facilitator returns verified settlement with a Casper transaction hash.

The repo-local resource sidecar keeps an in-process replay store. A duplicate payment payload or nonce already used for a successful response returns `409 payment_replayed` and does not return the protected resource body.

Use this env while testing the local sidecar:

```env
X402_ENABLE_REAL_SETTLEMENT=true
X402_SETTLEMENT_MODE=resource-retry
X402_RESOURCE_DEMO_URL=http://localhost:4021/weather
X402_SIGNER_URL=http://localhost:4030/sign
X402_PAYMENT_HEADER_NAME=PAYMENT-SIGNATURE
X402_RESOURCE_AMOUNT=2500000000
X402_RESOURCE_TIMEOUT_SECONDS=60
```

The matching Grimoire policy must allow:

```json
{
  "allowed_urls": ["http://localhost:4021/weather"],
  "allowed_methods": ["GET"],
  "allowed_asset": {
    "caip2_chain_id": "casper:casper-test",
    "asset": "casper-native-cspr",
    "pay_to": "02032878c27882713870adf0e7546a082e991147824e77b710aaa77f47c6d972b041",
    "scheme": "exact"
  },
  "max_amount_per_call": "2500000000"
}
```

Quick sidecar-only smoke:

```bash
npm run demo:x402-sidecars:smoke --prefix backend
```

Without `X402_SIGNER_URL`, the smoke checks only the 402 challenge. With `X402_SIGNER_URL`, a configured signer, and a facilitator able to settle, it signs, retries, verifies `PAYMENT-RESPONSE`, and requires a Casper transaction hash.

## Real Casper Settlement Smoke

The full MCP-driven native CSPR smoke is documented in [Casper x402 Runbook](/casper-x402-runbook). First configure a Casper testnet wallet:

```bash
mainspring wallet setup <absolute-path-outside-repo>/backend.pem
```

That command writes the testnet RPC/account values and enables real Casper plus
real x402:

```env
CASPER_NETWORK_NAME=casper-test
CASPER_CAIP2_CHAIN_ID=casper:casper-test
CASPER_RPC_URL=https://node.testnet.casper.network/rpc
CASPER_ACCOUNT_KEY_PATH=<absolute-path-outside-repo>/backend.pem
CASPER_ENABLE_REAL_SUBMISSION=true
X402_ENABLE_REAL_SETTLEMENT=true
X402_SETTLEMENT_MODE=casper-cli
X402_BUYER_PRIVATE_KEY_PATH=<absolute-path-outside-repo>/backend.pem
```

For the local resource/facilitator smoke, also configure:

```env
X402_FACILITATOR_URL=http://127.0.0.1:4022
X402_RESOURCE_DEMO_URL=http://127.0.0.1:4021/weather
X402_RESOURCE_AMOUNT=2500000000
X402_ASSET_ID=casper-native-cspr
X402_BUYER_ACCOUNT_HASH=account-hash-d0a57c6a95e74463de156cac761e17f0923eafc730ce3ce3a0c747c6598b0500
X402_BUYER_PRIVATE_KEY_PATH=<absolute-path-outside-repo>/backend.pem
X402_PAY_TO=02032878c27882713870adf0e7546a082e991147824e77b710aaa77f47c6d972b041
X402_SIGNER_URL=http://127.0.0.1:4030/sign
X402_PAYMENT_HEADER_NAME=PAYMENT-SIGNATURE
```

Run:

```bash
npm run smoke:x402-payment-fetch --prefix backend
```

Expected output includes:

```text
Mr Mainspring Casper x402 payment.fetch smoke
resource=http://127.0.0.1:4021/weather
policy_id=pol-casper-x402-smoke-<timestamp>
PASS payment.fetch: status=settled settlement=settled payment_id=pay_<hex>
PASS payment.receipt: settlement_status=settled casper_transaction_hash=<64-hex>
PASS policy.spend: before=0 after_preflight=0 after_settlement=2500000000
PASS audit.tail: events=payment.challenge_received,payment.settled,policy.spend_recorded
RESULT PASS
```

Then verify the hash on Casper:

```bash
casper-client get-transaction \
  --node-address https://node.testnet.casper.network/rpc \
  <casper_transaction_hash>
```

The transaction must include execution info and no `Failure` or `error_message`.

## Casper Facilitator Sidecar

For on-chain Casper settlement, run the facilitator sidecar after configuring `CASPER_RPC_URL`, `CASPER_ACCOUNT_KEY_PATH`, and `CASPER_ENABLE_REAL_SUBMISSION=true`:

```bash
npm run x402:facilitator --prefix backend
```

It exposes `POST /verify` and `POST /settle` on `http://127.0.0.1:4022` by default. `/verify` validates the signature, selected requirement hash, amount, payee, asset, network, method, resource, nonce, timeout, and replay state without submitting a Casper transaction. `/settle` repeats validation, consumes the nonce, submits the Casper settlement transaction, waits for execution success, and returns `settled: true` only with the real Casper transaction hash.

The facilitator rejects stale payloads, duplicate payloads, nonce replays, wrong payee, wrong amount, wrong asset, wrong network, and wrong resource before settlement submission.

If the captured requirements do not match the policy, the challenge remains durable but settlement is marked unavailable before any signing/payment action:

```json
{
  "allowed": true,
  "status": "settlement_unavailable",
  "settlement": "unavailable",
  "settlement_blocker": "x402_requirements_not_allowed"
}
```

If the resource is free, Mr Mainspring hashes the response body and does not claim a payment:

```json
{
  "allowed": true,
  "status": "policy_checked",
  "settlement": "not_required",
  "challenge": {
    "status": "free_response",
    "status_code": 200,
    "response_hash": "sha256-hex"
  }
}
```

If the resource returns an unexpected non-402 error, Mr Mainspring records an honest unavailable state:

```json
{
  "allowed": true,
  "status": "settlement_unavailable",
  "settlement": "unavailable",
  "settlement_blocker": "x402_unexpected_resource_response"
}
```

## Idempotency

When `idempotency_key` is present, Mr Mainspring returns the same persisted intent for the same `agent_id` and key. This avoids duplicate intent creation and prevents replaying the challenge request for the same idempotent call.

## What Is Not Implemented

- Grimoire-backed signing capability retrieval.
- Native in-process Casper signed x402 payload creation.
- A pinned external/public Casper x402 facilitator. The repo-local facilitator is the current native CSPR testnet path.
- Automatic recovery when a payment settles but the resource body is not delivered.
- Durable shared replay storage across restarts or multiple sidecar instances.
- Atomic cross-process policy spend reservations.

## Manual Credentials and Resources Needed for Real x402

Real settlement still requires all of the following outside repo files:

- A funded buyer wallet or signing provider for the target x402 scheme and network. Private keys must stay outside the repository; use an external signer sidecar, wallet/KMS, or an encrypted Grimoire secret reference in a separate component.
- A running x402 resource server that returns real `PAYMENT-REQUIRED` requirements for the protected endpoint.
- A facilitator URL with working `/verify` and `/settle` endpoints for the selected `(scheme, network)` pair.
- Casper RPC/network configuration for the target network when using the Casper path.
- A deployed x402-compatible Casper asset package/token if using CEP-18. The current runbook path uses native CSPR and does not require a CEP-18 package hash.
- A Grimoire policy whose allowlist includes the exact resource URL, method, max amount, CAIP-2 network, asset package, payee, and scheme expected from the resource server.
- A non-demo `GRIMOIRE_MASTER_KEY` if any signing secret reference is stored locally.
