---
title: Payments and x402
description: Durable payment intents, x402 challenge capture, requirement approval, and honest pre-settlement behavior.
section: Core Modules
status: pre-settlement
last_verified: 2026-06-05
---

# Payments and x402

The payment module is intentionally conservative. It creates durable payment intents, can request the first x402 challenge after Grimoire policy approval, validates captured payment requirements, and then enters an explicit settlement-provider boundary. By default that provider is disabled, so the backend persists an unavailable receipt instead of claiming signed payload creation, facilitator settlement, or Casper settlement.

## Flow States

```text
created
policy_denied
policy_checked
challenge_received
settlement_unavailable
settled
```

`settled` is reserved for a provider result that genuinely verifies settlement. The current production wiring does not enable real settlement because no Casper-compatible signing provider/facilitator has been verified in this repo.

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

Mr Mainspring currently implements the safe pre-signing portion and a disabled settlement boundary:

```text
challenge capture
Grimoire policy approval
captured requirement approval against policy
settlement provider boundary
default disabled receipt
```

The exact backend boundary is:

| Boundary | Current status |
| --- | --- |
| Challenge capture | Implemented. The first HTTP request can capture `PAYMENT-REQUIRED`, `X-PAYMENT-REQUIRED`, JSON body requirements, or a raw body fallback. |
| Policy approval | Implemented before any challenge request. URL, method, and expected amount are checked against the Grimoire policy. |
| Requirement approval | Implemented after challenge capture and before any future signing. The selected requirement must match amount, resource URL, optional method, network, configured asset, configured payee, and configured scheme. |
| Payment payload signing | Interface exists, but production wiring is disabled. No private key is read and no `PAYMENT-SIGNATURE` payload is created by default. |
| Facilitator `/verify` | Provider boundary exists and must pass before `/settle`; verify output alone never marks settlement. |
| Facilitator `/settle` | Provider boundary verifies a successful settlement response with a transaction hash before returning `settled`, but no real Casper-compatible facilitator has been verified yet. |
| Receipt persistence | Implemented for unavailable, failed, and settled provider outcomes. The default receipt is `settlement_unavailable`. |

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
- Production signed x402 payment payload creation.
- Retrying the resource request with payment authorization.
- A verified real facilitator `/verify` and `/settle` run for Casper.
- Casper transaction hash recording for real x402 settlement.

## Manual Credentials and Resources Needed for Real x402

Real settlement still requires all of the following outside repo files:

- A funded buyer wallet or signing provider for the target x402 scheme and network. Private keys must stay outside the repository; use an external wallet/KMS or an encrypted Grimoire secret reference.
- A running x402 resource server that returns real `PAYMENT-REQUIRED` requirements for the protected endpoint.
- A facilitator URL with working `/verify` and `/settle` endpoints for the selected `(scheme, network)` pair.
- Casper RPC/network configuration for the target network when using the Casper path.
- A deployed x402-compatible Casper asset package/token and a funded payee account.
- A Grimoire policy whose allowlist includes the exact resource URL, method, max amount, CAIP-2 network, asset package, payee, and scheme expected from the resource server.
- A non-demo `GRIMOIRE_MASTER_KEY` if any signing secret reference is stored locally.
