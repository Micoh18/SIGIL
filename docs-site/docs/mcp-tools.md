---
title: MCP Tools
description: Current SIGIL MCP tool surface grouped by memory, Grimoire, payments, and audit.
section: Core Modules
status: current
last_verified: 2026-06-05
---

# MCP Tools

SIGIL exposes tools through `backend/src/mcp/*`. Machine-readable summaries are generated at [/api/tool-schemas.json](/api/tool-schemas.json).

## Memory Tools

| Tool | Purpose |
| --- | --- |
| `memory.write` | Store a memory envelope, compute deterministic hashes, and optionally request anchor metadata. |
| `memory.read` | Read a stored memory by `agent_id` and `memory_id`. |
| `memory.search` | Search stored memory summaries for an agent. |
| `memory.verify` | Recompute local hashes and report integrity plus anchor metadata. |

## Grimoire Tools

| Tool | Purpose |
| --- | --- |
| `grimoire.secret.put` | Encrypt and store a scoped secret. Plaintext is never returned. |
| `grimoire.secret.list` | List secret metadata only. |
| `grimoire.policy.set` | Store a spending/access policy with deterministic policy hash. |
| `grimoire.policy.get` | Read one policy and local spend metadata. |

## Payment Tools

| Tool | Purpose |
| --- | --- |
| `payment.fetch` | Check policy, persist an intent, and optionally capture the first x402 challenge. |
| `payment.receipt` | Read persisted payment intent and receipt metadata. |

Current payment states are:

```text
created
policy_denied
policy_checked
challenge_received
settlement_unavailable
settled
```

`settled` is reserved for genuinely verified settlement. The current backend does not create settled receipts.

## Audit Tools

| Tool | Purpose |
| --- | --- |
| `audit.tail` | Return recent audit events for an agent or event type. |

## Example Sequence

```json
{
  "tool": "grimoire.policy.set",
  "arguments": {
    "agent_id": "agent-demo-1",
    "policy_id": "pol_demo_weather",
    "allowed_urls": ["http://localhost:4021/weather"],
    "allowed_methods": ["GET"],
    "allowed_asset": {
      "caip2_chain_id": "casper:casper-test",
      "asset_package": "demo-asset-package"
    },
    "max_amount_per_call": "0.05",
    "max_amount_per_period": "1.00",
    "period_seconds": 86400,
    "secret_scopes": ["x402:sign"]
  }
}
```

```json
{
  "tool": "payment.fetch",
  "arguments": {
    "agent_id": "agent-demo-1",
    "policy_id": "pol_demo_weather",
    "method": "GET",
    "url": "http://localhost:4021/weather",
    "expected_amount": "0.01",
    "idempotency_key": "demo-weather-001",
    "request_challenge": true
  }
}
```
