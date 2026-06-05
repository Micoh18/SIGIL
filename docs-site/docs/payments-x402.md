---
title: Payments and x402
description: Durable payment intents, x402 challenge capture, requirement approval, and honest pre-settlement behavior.
section: Core Modules
status: pre-settlement
last_verified: 2026-06-05
---

# Payments and x402

The payment module is intentionally conservative. It creates durable payment intents, can request the first x402 challenge after Grimoire policy approval, and validates captured payment requirements before the future signing boundary. It does not claim signed payload creation, facilitator settlement, or Casper settlement.

## Flow States

```text
created
policy_denied
policy_checked
challenge_received
settlement_unavailable
settled
```

`settled` is reserved for a future path that genuinely verifies settlement. The current implementation does not set settled.

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

Mr Mainspring currently implements only the safe pre-signing portion:

```text
challenge capture
Grimoire policy approval
captured requirement approval against policy
signing/payment boundary stops here
```

The exact backend boundary is:

| Boundary | Current status |
| --- | --- |
| Challenge capture | Implemented. The first HTTP request can capture `PAYMENT-REQUIRED`, `X-PAYMENT-REQUIRED`, JSON body requirements, or a raw body fallback. |
| Policy approval | Implemented before any challenge request. URL, method, and expected amount are checked against the Grimoire policy. |
| Requirement approval | Implemented after challenge capture and before any future signing. The selected requirement must match amount, resource URL, optional method, network, configured asset, configured payee, and configured scheme. |
| Payment payload signing | Not implemented. No private key is read and no `PAYMENT-SIGNATURE` payload is created. |
| Facilitator `/verify` | Not implemented. Verification response parsing is not enough to mark settlement. |
| Facilitator `/settle` | Not implemented. Settlement can only be claimed after a successful settlement response with a transaction hash is verified. |
| Receipt persistence | Store shape exists, but real x402 receipts are not written because `/settle` is not called. |

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
  "status": "challenge_received",
  "settlement": "not_started",
  "settlement_blocker": "signed_payload_not_implemented",
  "challenge": {
    "status": "payment_required",
    "status_code": 402,
    "requirements_source": "json-body"
  }
}
```

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
- Signed x402 payment payload creation.
- Retrying the resource request with payment authorization.
- Facilitator `/verify` calls.
- Facilitator `/settle` calls.
- Casper transaction hash recording for x402 settlement.

## Manual Credentials and Resources Needed for Real x402

Real settlement still requires all of the following outside repo files:

- A funded buyer wallet or signing provider for the target x402 scheme and network. Private keys must stay outside the repository; use an external wallet/KMS or an encrypted Grimoire secret reference.
- A running x402 resource server that returns real `PAYMENT-REQUIRED` requirements for the protected endpoint.
- A facilitator URL with working `/verify` and `/settle` endpoints for the selected `(scheme, network)` pair.
- Casper RPC/network configuration for the target network when using the Casper path.
- A deployed x402-compatible Casper asset package/token and a funded payee account.
- A Grimoire policy whose allowlist includes the exact resource URL, method, max amount, CAIP-2 network, asset package, payee, and scheme expected from the resource server.
- A non-demo `GRIMOIRE_MASTER_KEY` if any signing secret reference is stored locally.
