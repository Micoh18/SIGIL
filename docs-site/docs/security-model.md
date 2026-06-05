---
title: Security Model
description: Current SIGIL security boundaries for memory, secrets, policies, x402, Casper anchoring, and audit.
section: Reference
status: current
last_verified: 2026-06-05
---

# Security Model

SIGIL is built around explicit boundaries: agents can ask for actions, but the backend owns secret storage, policy enforcement, hashing, and payment state transitions.

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

The implemented path captures requirements and response hashes. It does not sign payloads or submit settlement. This avoids false-positive payment claims while the facilitator path is not verified.

## Casper Boundary

The anchor client validates hash payloads and returns pending metadata. It does not claim a transaction hash until a real Casper submission and verification path exists.

## Operational Gaps

- No remote HTTP MCP transport yet.
- No production database migrations yet.
- No KMS/HSM integration yet.
- No real Casper transaction submission yet.
- No real x402 settlement verification yet.
