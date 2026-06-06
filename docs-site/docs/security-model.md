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
| Payment authorization | External signing only; signed x402 payloads are validated for requirement hash, validity window, and replay before settlement/resource release. |
| Casper anchoring | Hash metadata only; configured submissions require `casper-client` and never include memory bodies. |
| Audit events | Redacted local events for debugging and evaluator review. |

## Data Handling Rules

- Do not return Grimoire plaintext secret values.
- Do not write private keys, signed payment payloads, or payment authorization material to audit logs.
- Do not write memory bodies or secrets on-chain.
- Anchor hashes only.
- Persist payment intents before attempting external challenge requests.
- Check current period spend before requesting a signature for an approved x402 requirement.
- Store replay keys as hashes of nonce/payer/network material, not raw signed payloads.
- Use idempotency keys for payment retries.

## Secret Storage

Local secrets are encrypted with AES-256-GCM. `GRIMOIRE_MASTER_KEY` must be a base64-encoded 32-byte key for non-demo use. If omitted, Mainspring generates one automatically for local use; production secrets should live in a private env file.

## Policy Enforcement

Payment policy checks are deny-by-default:

```text
policy_not_found
policy_disabled
url_not_allowed
method_not_allowed
amount_over_limit
period_limit_exceeded
invalid_amount
```

The current policy matcher uses exact URL and method allowlists, per-call amount checks, and current-period spend checks. x402 requirement approval validates network, asset, amount, resource URL, method, payee, and scheme before a signer can be called.

## x402 Boundary

The implemented path captures requirements, validates them against policy, checks the current period spend window, and then reaches a settlement provider boundary. The default provider is disabled and persists `settlement_unavailable` receipt metadata rather than signing payloads or submitting settlement.

When real settlement is enabled, the backend delegates signing to `X402_SIGNER_URL`, validates the returned payload validity window and selected requirement hash, retries the paid resource, and accepts settlement only when `PAYMENT-RESPONSE` verifies against the approved requirement and signed payer. The repo-local paid resource and facilitator sidecars also reject stale payloads, duplicate payloads, nonce replays, wrong payee, wrong amount, wrong asset, wrong network, and wrong resource.

Receipts, MCP outputs, logs, and audit events keep hashes and metadata only. Raw signatures, authorization payloads, private keys, bearer tokens, and command-line secret-key paths are redacted.

## Casper Boundary

The anchor client validates hash payloads and keeps the unconfigured path local-only. When contract hashes, Casper CLI env, and `CASPER_ENABLE_REAL_SUBMISSION=true` are configured, it submits `anchor_memory` through `casper-client` and records a transaction hash only if the command returns one. That transaction hash is pending evidence, not finality. The backend does not read or print private key material, and it does not yet verify execution/finality with `get-transaction`.

## Operational Gaps

- No remote HTTP MCP transport yet.
- No production database migrations yet.
- No KMS/HSM integration yet.
- Replay storage is in-process for the repo-local resource/facilitator sidecars. A multi-instance deployment needs durable shared replay storage with expiry.
- Period spend checks include current spend before signing, but the file/Supabase stores do not provide a transactional cross-process reservation yet.
- The signer sidecar still returns a raw signed payload to the backend by design; protect that HTTP channel with local binding, TLS or a trusted network, and bearer auth.

## Evaluator Security Checks

During a local demo, check that:

- `grimoire.secret.put` returns metadata, not plaintext secret values.
- `payment.receipt` returns intent/receipt metadata, not signed payment payloads.
- `memory.write` with `anchor: true` returns pending anchor metadata unless real Casper contract hashes, CLI env, and `CASPER_ENABLE_REAL_SUBMISSION=true` are configured.
- `audit.tail` shows useful events without private keys, raw secrets, or signed authorization material.
