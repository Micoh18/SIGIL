---
title: Architecture
description: Module boundaries and data flow for the Mr Mainspring MCP backend.
section: Start
status: current
last_verified: 2026-06-05
---

# Architecture

Mr Mainspring is organized around MCP tools backed by small service modules and file-backed stores. The current implementation is intentionally local-first so the backend can be tested without a database server, a Casper node, or a running x402 facilitator.

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
| Casper memory-anchor contract | Source/spec stub only. |
| x402 challenge request | Implemented for first HTTP request and 402 requirements capture. |
| x402 signed settlement | Not implemented until a real facilitator flow is run and verified. |
