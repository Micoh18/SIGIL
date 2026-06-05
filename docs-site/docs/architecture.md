---
title: Architecture
description: Module boundaries and data flow for the Mr Mainspring MCP backend.
section: Start
status: current
last_verified: 2026-06-05
---

# Architecture

Mr Mainspring is organized around MCP tools backed by small service modules and file-backed stores. The current implementation is intentionally local-first so the backend can be tested without a database server, a Casper node, or a running x402 facilitator.

## Architecture in 5 Minutes

1. **Interface:** The implemented runtime surface is a stdio MCP server. Agents call named MCP tools; there is no remote HTTP MCP transport yet.
2. **Services:** Tool handlers delegate to local TypeScript services for memory, Grimoire, payments, anchoring, and audit. Services own validation, hashing, state transitions, and redaction.
3. **State:** The backend persists JSON stores under `SIGIL_DATA_DIR`. This keeps evaluator runs simple and deterministic; it is not a production database layer.
4. **Proof boundary:** Memory bodies and secrets stay local. The backend computes SHA-256 proof material and sends only hash metadata toward the Casper anchor client interface.
5. **Payment boundary:** `payment.fetch` approves or denies policy, persists an intent, and can capture the first x402 challenge. It stops before Grimoire-backed signing, paid retry, facilitator settlement, or Casper settlement proof.
6. **Audit:** Each major service emits redacted audit events so a local run can be reconstructed without exposing secret values or signed payment material.

For evaluator work, this means a successful demo proves local MCP semantics and durable state transitions. It does not prove external settlement until the missing Casper and x402 paths are implemented and verified.

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
              `-- local append-only event view
```

## Request Path

| Step | Component | Responsibility |
| --- | --- | --- |
| 1 | MCP tool wrapper | Validate the tool input shape and call the relevant service. |
| 2 | Service module | Apply domain rules such as canonical memory hashing, policy checks, or payment state transitions. |
| 3 | Store | Persist JSON records under `SIGIL_DATA_DIR` and return durable ids. |
| 4 | Audit | Append a redacted event for later inspection. |
| 5 | External boundary | Return pending or unavailable metadata unless a real external integration is implemented and verified. |

## Durable Stores

The backend currently writes JSON files under `SIGIL_DATA_DIR`:

| Store | File | Purpose |
| --- | --- | --- |
| Memory | `memory.json` | Canonical memory records, hashes, and anchor metadata. |
| Grimoire | `grimoire.json` | Encrypted secrets and policy records. |
| Payments | `payments.json` | Payment intents and receipts. |
| Audit | `audit.json` | Redacted audit events. |

The product spec describes a SQLite/Postgres path, but the implemented backend uses file stores for hackathon velocity and deterministic tests.

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
| Casper anchor client | Interface implemented. Real transaction submission is not implemented. |
| Casper memory-anchor contract | Hash-only source exists and builds to Wasm. Testnet deploy/query is not complete. |
| x402 challenge request | Implemented for first HTTP request and 402 requirements capture. |
| x402 signed settlement | Not implemented until a real facilitator flow is run and verified. |
