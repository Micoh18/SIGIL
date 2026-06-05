---
title: Architecture
description: Module boundaries and data flow for the Mr Mainspring MCP backend.
section: Start
status: current
last_verified: 2026-06-05
---

# Architecture

Mr Mainspring is organized around MCP tools backed by small service modules and pluggable stores. The default implementation is intentionally local-first so the backend can be tested without a database server, a Casper node, or a running x402 facilitator. Supabase can be enabled for remote persistence after the included schema is applied.

## Architecture in 5 Minutes

1. **Interface:** The implemented runtime surface is a stdio MCP server. Agents call named MCP tools; there is no remote HTTP MCP transport yet.
2. **Services:** Tool handlers delegate to local TypeScript services for memory, Grimoire, payments, anchoring, and audit. Services own validation, hashing, state transitions, and redaction.
3. **State:** The backend persists JSON stores under `SIGIL_DATA_DIR` by default. When `SIGIL_STORAGE_BACKEND=supabase`, it writes the same domain records to Supabase JSONB tables through the Supabase REST API.
4. **Proof boundary:** Memory bodies and secrets stay local. The backend computes SHA-256 proof material and sends only hash metadata toward the Casper anchor client interface.
5. **Payment boundary:** `payment.fetch` approves or denies policy, persists an intent, can capture the first x402 challenge, and can persist an unavailable settlement receipt when the settlement provider is disabled. It stops before production Grimoire-backed signing, paid retry, facilitator settlement, or Casper settlement proof.
6. **Audit:** Each major service emits redacted audit events so a local run can be reconstructed without exposing secret values or signed payment material.

For evaluator work, this means a successful default demo proves local MCP semantics and durable state transitions. Casper submission can be enabled with real testnet env, but automatic finality verification and x402 settlement still require separate external checks.

## System Map

```text
Agent / MCP client
        |
        | stdio MCP tools
        v
Mr Mainspring TypeScript backend
        |
        |-- Memory service
        |     |-- canonical JSON envelope
        |     |-- SHA-256 content and metadata hashes
        |     `-- Casper anchor client interface
        |
        |-- Grimoire service
        |     |-- AES-GCM encrypted secrets
        |     `-- allowlisted policies with deterministic policy hashes
        |
        |-- Payment service
        |     |-- policy approval/denial
        |     |-- durable intent store
        |     `-- optional x402 challenge capture
        |
        `-- Audit service
              `-- append-only event view

Store adapter
        |-- JSON files under SIGIL_DATA_DIR
        `-- optional Supabase tables with JSONB records
```

## Request Path

| Step | Component | Responsibility |
| --- | --- | --- |
| 1 | MCP tool wrapper | Validate the tool input shape and call the relevant service. |
| 2 | Service module | Apply domain rules such as canonical memory hashing, policy checks, or payment state transitions. |
| 3 | Store | Persist records under `SIGIL_DATA_DIR` or Supabase and return durable ids. |
| 4 | Audit | Append a redacted event for later inspection. |
| 5 | External boundary | Return pending or unavailable metadata unless a real external integration is implemented and verified. |

## Durable Stores

The backend defaults to JSON files under `SIGIL_DATA_DIR`:

| Store | File | Purpose |
| --- | --- | --- |
| Memory | `memory.json` | Canonical memory records, hashes, and anchor metadata. |
| Grimoire | `grimoire.json` | Encrypted secrets and policy records. |
| Payments | `payments.json` | Payment intents and receipts. |
| Audit | `audit.json` | Redacted audit events. |

Supabase is available as an optional persistence backend. Run `backend/supabase/schema.sql`, then set `SIGIL_STORAGE_BACKEND=supabase`, `PROJECT_URL`, and either `SECRET_KEY` or `PUBLISHABLE_KEY`. The Supabase adapter uses one table per store and keeps the current domain record in a `record jsonb` column with scalar lookup columns for the queries the services need.

| Store | Supabase Table |
| --- | --- |
| Memory | `sigil_memories` |
| Grimoire secrets | `sigil_secrets` |
| Grimoire policies | `sigil_policies` |
| Payments intents | `sigil_payment_intents` |
| Payment receipts | `sigil_payment_receipts` |
| Audit | `sigil_audit_events` |

The product spec describes richer SQLite/Postgres domain migrations. The Supabase adapter is a practical remote persistence bridge, not the final normalized production schema.

## Trust Boundaries

Mr Mainspring separates sensitive content from public proof material:

- Memory bodies stay off-chain.
- Secret values are encrypted and never returned by MCP tools.
- Signed x402 payloads are not returned and are not implemented yet.
- Casper anchoring is hash-only.
- Audit metadata is redacted and intended for demo/debug visibility.

## Current External Integrations

| Integration | Current Status |
| --- | --- |
| MCP stdio | Implemented and covered by tests. |
| Supabase persistence | Optional store adapter implemented through REST and covered by mocked tests. |
| Casper anchor client | Configured CLI submission boundary implemented behind `CASPER_ENABLE_REAL_SUBMISSION`; execution verification is still manual. |
| Casper memory-anchor contract | Hash-only source builds to Wasm and is deployed on testnet; backend submission is smoke-tested, while automatic execution/query verification is still manual. |
| x402 challenge request | Implemented for first HTTP request and 402 requirements capture. |
| x402 signed settlement | Provider boundary and tests exist, but real signing/settlement remains disabled until a real facilitator flow is run and verified. |
