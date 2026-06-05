---
title: Payments and x402
description: Durable payment intents, x402 challenge capture, and honest pre-settlement behavior.
section: Core Modules
status: pre-settlement
last_verified: 2026-06-05
---

# Payments and x402

The payment module is intentionally conservative. It creates durable payment intents and can request the first x402 challenge after policy approval, but it does not claim signed payload creation or Casper settlement.

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

If the resource returns HTTP 402, SIGIL captures `PaymentRequirements` from a JSON body or standard x402 headers and persists `requirements_json`.

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

If the resource is free, SIGIL hashes the response body and does not claim a payment:

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

If the resource returns an unexpected non-402 error, SIGIL records an honest unavailable state:

```json
{
  "allowed": true,
  "status": "settlement_unavailable",
  "settlement": "unavailable",
  "settlement_blocker": "x402_unexpected_resource_response"
}
```

## Idempotency

When `idempotency_key` is present, SIGIL returns the same persisted intent for the same `agent_id` and key. This avoids duplicate intent creation and prevents replaying the challenge request for the same idempotent call.

## What Is Not Implemented

- Selecting and validating a specific payment requirement against asset/payee policy beyond the current policy preflight.
- Grimoire-backed signing capability retrieval.
- Signed x402 payment payload creation.
- Retrying the resource request with payment authorization.
- Facilitator settlement verification.
- Casper transaction hash recording for x402 settlement.
