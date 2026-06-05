---
title: Audit Trail
description: Local audit event shape and current events emitted by Mr Mainspring services.
section: Core Modules
status: implemented
last_verified: 2026-06-05
---

# Audit Trail

The audit module provides a local redacted event trail for demo and debugging. It is implemented with a JSON-file store and exposed through `audit.tail`.

## Event Shape

```json
{
  "id": "aud_...",
  "agent_id": "agent-demo-1",
  "event_type": "payment.policy_approved",
  "subject_type": "payment",
  "subject_id": "pay_...",
  "severity": "info",
  "metadata": {
    "policy_id": "pol_demo_weather"
  },
  "created_at": "2026-06-05T00:00:00.000Z"
}
```

## Common Events

| Event | Source |
| --- | --- |
| `memory.created` | `memory.write` persisted a record. |
| `memory.anchor_submitted` | Anchor metadata was submitted to the current anchor client. |
| `memory.verify_succeeded` | Local memory verification matched the stored hash. |
| `memory.verify_failed` | Verification did not match or the memory was missing. |
| `secret.stored` | A Grimoire secret was encrypted and stored. |
| `secret.listed` | Secret metadata was listed. |
| `policy.set` | A policy was created or updated. |
| `policy.get` | A policy lookup occurred. |
| `payment.policy_approved` | Payment policy preflight passed. |
| `payment.policy_denied` | Payment policy preflight failed. |
| `payment.challenge_received` | A 402 challenge was captured. |
| `payment.challenge_not_required` | The resource responded successfully without payment. |
| `payment.settlement_unavailable` | The resource or local setup could not continue toward settlement. |

## Tail Query

```json
{
  "agent_id": "agent-demo-1",
  "limit": 20
}
```

The response returns newest relevant events first. Audit metadata must not include raw secrets, private keys, memory bodies unless explicitly written as memory content, or signed payment payloads.
