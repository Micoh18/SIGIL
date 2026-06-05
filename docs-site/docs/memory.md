---
title: Memory
description: SIGIL memory envelopes, hashing rules, search, verification, and anchor metadata.
section: Core Modules
status: implemented
last_verified: 2026-06-05
---

# Memory

The memory module stores full agent records off-chain and computes deterministic proof material. It is implemented in `backend/src/memory/*` and exposed through `memory.write`, `memory.read`, `memory.search`, and `memory.verify`.

## Memory Types

```text
observation
decision
payment
secret_usage
system_event
```

## Envelope

`memory.write` builds a canonical envelope before hashing:

```json
{
  "schema_version": "sigil.memory.v1",
  "agent_id": "agent-demo-1",
  "memory_id": "mem_...",
  "type": "observation",
  "source": {
    "kind": "x402_http",
    "url": "http://localhost:4021/weather"
  },
  "body": {
    "summary": "Weather data purchase preflight completed."
  },
  "created_at": "2026-06-05T00:00:00.000Z",
  "prev_anchor_hash": null
}
```

The canonical JSON and content hash are stored with local mutable metadata such as anchor status and update time.

## Hashing

SIGIL computes:

```text
content_hash = sha256(canonical_memory_envelope)
metadata_hash = sha256(canonical_metadata_subset)
anchor_id = sha256(agent_id + ":" + memory_id + ":" + content_hash + ":" + prev_anchor_hash)
```

The current backend uses lowercase SHA-256 hex strings.

## Anchor Status

| Status | Meaning |
| --- | --- |
| `not_requested` | The memory was written without `anchor: true`. |
| `pending` | The anchor client accepted hash metadata locally, but no verified Casper transaction hash exists. |
| `anchored` | Reserved for a verified on-chain anchor. |
| `failed` | Reserved for a failed anchor attempt. |

## Verification

`memory.verify` recomputes the local content hash and compares it to the stored hash. Until real Casper querying is implemented, `onchain_content_hash` remains null and local integrity is the only verified claim.
