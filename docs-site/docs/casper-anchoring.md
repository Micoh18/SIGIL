---
title: Casper Anchoring
description: Current Casper anchor client boundary and the memory-anchor contract stub.
section: Core Modules
status: stub
last_verified: 2026-06-05
---

# Casper Anchoring

SIGIL is designed to anchor hash-only memory proofs on Casper. The current repository has the backend interface and validation path, but not a verified real transaction submission path.

## Backend Client Modes

`createCasperAnchorClient` selects a client from environment/config:

| Mode | When Selected | Behavior |
| --- | --- | --- |
| `unconfigured` | `MEMORY_ANCHOR_CONTRACT_HASH` is absent. | Accepts validated local hash metadata and returns `pending` with `casper_contract_not_configured`. |
| `configured` | Contract hash plus RPC and account key config are present. | Validates config and returns `pending` with `casper_transaction_submission_not_implemented`. |

Both modes validate anchor payloads. Neither mode currently submits a Casper transaction.

## Anchor Submission

The backend creates:

```json
{
  "anchor_id": "sha256-hex",
  "agent_id_hash": "sha256-hex",
  "memory_id_hash": "sha256-hex",
  "content_hash": "sha256-hex",
  "metadata_hash": "sha256-hex",
  "prev_anchor_hash": null
}
```

The privacy boundary is deliberate: memory bodies, secret values, signed payment payloads, and private keys must not be written on-chain.

## Contract Status

`contracts/memory-anchor/` is a source/spec stub. It currently contains a placeholder `call()` entry point and planned storage/entrypoint comments.

Planned entry points:

```text
anchor_memory(agent_id_hash, memory_id_hash, content_hash, metadata_hash, prev_anchor_hash)
anchor_policy(policy_id_hash, policy_hash)
set_admin(account_hash, enabled)
```

::: warning Contract limitation
Treat the current contract as non-deployed and non-buildable until it is replaced by a real `cargo-casper` project and verified with Rust/Casper tooling.
:::
