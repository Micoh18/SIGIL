---
title: Security Model
description: Current Mr Mainspring security boundaries for memory, secrets, policies, x402, Casper anchoring, and audit.
section: Reference
status: current
last_verified: 2026-06-05
---

# Security Model

Mr Mainspring is built around explicit boundaries: agents can ask for actions, but the backend owns secret storage, policy enforcement, hashing, and payment state transitions.

## Security Posture Snapshot

| Boundary | Current Behavior |
| --- | --- |
| Secret values | AES-GCM encrypted locally and never returned by MCP tools. |
| Memory bodies | Stored locally, hashed deterministically, and kept off-chain. |
| Payment authorization | Settlement provider boundary exists; production signed x402 payloads are not produced or persisted by default. |
| Casper anchoring | Hash metadata only; configured submissions require `casper-client` and never include memory bodies. |
| Audit events | Redacted local events for debugging and evaluator review. |

## Data Handling Rules

- Do not return Grimoire plaintext secret values.
- Do not write private keys, signed payment payloads, or payment authorization material to audit logs.
- Do not write memory bodies or secrets on-chain.
- Anchor hashes only.
- Persist payment intents before attempting external challenge requests.
- Use idempotency keys for payment retries.

## Secret Storage

Local secrets are encrypted with AES-256-GCM. `GRIMOIRE_MASTER_KEY` must be a base64-encoded 32-byte key for non-demo use. If omitted, the backend uses a deterministic development key, which is only acceptable for local demos.

## Policy Enforcement

Payment policy checks are deny-by-default:

```text
policy_not_found
policy_disabled
url_not_allowed
method_not_allowed
amount_over_limit
invalid_amount
```

The current policy matcher uses exact URL and method allowlists and per-call amount checks. Future settlement work must validate x402 requirements against network, asset package, amount, resource URL, method, and payee before signing.

## x402 Boundary

The implemented path captures requirements, validates them against policy, and then reaches a settlement provider boundary. The default provider is disabled and persists `settlement_unavailable` receipt metadata rather than signing payloads or submitting settlement. This avoids false-positive payment claims while the facilitator path is not verified.

## Casper Boundary

The anchor client validates hash payloads and keeps the unconfigured path local-only. When contract hashes, Casper CLI env, and `CASPER_ENABLE_REAL_SUBMISSION=true` are configured, it submits `anchor_memory` through `casper-client` and records a transaction hash only if the command returns one. That transaction hash is pending evidence, not finality. The backend does not read or print private key material, and it does not yet verify execution/finality with `get-transaction`.

## Operational Gaps

- No remote HTTP MCP transport yet.
- No production database migrations yet.
- No KMS/HSM integration yet.
- No automatic Casper transaction execution verification yet.
- No real x402 settlement verification yet.

## Evaluator Security Checks

During a local demo, check that:

- `grimoire.secret.put` returns metadata, not plaintext secret values.
- `payment.receipt` returns intent/receipt metadata, not signed payment payloads.
- `memory.write` with `anchor: true` returns pending anchor metadata unless real Casper contract hashes, CLI env, and `CASPER_ENABLE_REAL_SUBMISSION=true` are configured.
- `audit.tail` shows useful events without private keys, raw secrets, or signed authorization material.
