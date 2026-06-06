---
title: API/Schema Reference
description: Implemented MCP schema summaries, payment states, memory types, and machine-readable schema file links.
section: Reference
status: current
last_verified: 2026-06-05
---

# API/Schema Reference

The generated machine-readable tool schema file is available at:

```text
/api/tool-schemas.json
```

It covers:

```text
agent.whoami
memory.write
memory.read
memory.search
memory.verify
grimoire.secret.put
grimoire.secret.list
grimoire.policy.set
grimoire.policy.get
payment.fetch
payment.receipt
audit.tail
```

## Memory Types

```text
observation
decision
payment
secret_usage
system_event
```

## Anchor Status

```text
not_requested
pending
anchored
failed
```

## Payment Status

```text
created
policy_denied
policy_checked
challenge_received
settlement_unavailable
settled
```

`settled` is reserved for genuinely verified settlement. The default backend wiring keeps real settlement disabled and persists `settlement_unavailable`; with `X402_ENABLE_REAL_SETTLEMENT=true`, `X402_SIGNER_URL`, and a resource/facilitator response that verifies with a transaction hash, `payment.fetch` can emit `settled`.

## Payment Denial Reasons

```text
policy_not_found
policy_disabled
url_not_allowed
method_not_allowed
amount_over_limit
invalid_amount
```

## Payment Settlement State

```text
not_started
not_required
unavailable
settled
```

## Secret Types

```text
casper_private_key_ref
x402_client_key_ref
api_key
webhook_secret
```

## Audit Severity

```text
debug
info
warn
error
```

## Example Generated Schema Entry

```json
{
  "name": "payment.fetch",
  "status": "pre-settlement",
  "input": {
    "type": "object",
    "required": ["policy_id", "method", "url"],
    "properties": {
      "agent_id": { "type": "string", "minLength": 1 },
      "policy_id": { "type": "string", "minLength": 1 },
      "method": { "type": "string", "minLength": 1, "default": "GET" },
      "url": { "type": "string", "format": "uri" },
      "expected_amount": { "type": "string", "pattern": "^\\d+(\\.\\d+)?$" },
      "idempotency_key": { "type": "string", "minLength": 1 },
      "request_challenge": { "type": "boolean", "default": false }
    }
  }
}
```

The generated schema file should be treated as the canonical LLM-readable MCP tool summary for this docs milestone.
