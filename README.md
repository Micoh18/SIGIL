# SIGIL

SIGIL is backend infrastructure for agentic applications on Casper. It exposes an MCP server that gives agents:

- Verifiable memory with deterministic hashes and a Casper anchor interface.
- Grimoire secrets and spending policies without returning raw secret values to tools.
- Honest x402 payment preflight and durable payment records for Casper-native settlement work.
- A file-backed audit trail for demo and debugging.

Current focus: backend only. There is no frontend in this milestone.

## Repository layout

```text
backend/                    TypeScript MCP backend
contracts/memory-anchor/    Casper memory-anchor source/spec stub
backend-spec.md             Backend product and security spec
.env.example                Local backend environment template
docs/demo-runbook.md        Local demo guide
```

## Backend setup

```bash
cd backend
npm install
npm test
npm run build
npm run mcp:stdio
```

For development with live TypeScript:

```bash
cd backend
npm run dev
```

The MCP server writes local demo data under `.sigil/` unless `SIGIL_DATA_DIR` is set.

## Environment

Copy the root template and fill real values as they become available:

```bash
cp .env.example .env
```

Important values:

- `SIGIL_DATA_DIR`: local file-backed stores for memory, Grimoire, payments, and audit.
- `GRIMOIRE_MASTER_KEY`: base64-encoded 32-byte AES-GCM key. If omitted, the backend uses a deterministic local development key only.
- `X402_FACILITATOR_URL`: Casper x402 facilitator, expected at `http://localhost:4022` for the demo sidecar.
- `X402_RESOURCE_DEMO_URL`: demo paid resource, expected at `http://localhost:4021/weather`.
- `X402_ASSET_PACKAGE`: CEP-18/x402 token package hash when available.
- `CASPER_CAIP2_CHAIN_ID`: defaults to `casper:casper-test`.
- `MEMORY_ANCHOR_CONTRACT_HASH`: unset until the real Casper contract is deployed.

## Current MCP tools

- `memory.write`: store a memory envelope, content hash, metadata hash, optional local Casper anchor submission metadata.
- `memory.read`: read one memory by `agent_id` and `memory_id`.
- `memory.search`: simple local search over stored memory.
- `memory.verify`: recompute local hash and include local anchor metadata.
- `grimoire.secret.put`: encrypt and store a scoped secret. Plaintext is never returned.
- `grimoire.secret.list`: list secret metadata only.
- `grimoire.policy.set`: create or update an allowlisted spending/access policy.
- `grimoire.policy.get`: read policy metadata and spend fields.
- `payment.fetch`: create a durable x402 preflight record after policy checks. It returns `policy_checked` / `ready_for_x402_challenge` and does not claim real settlement.
- `payment.receipt`: read the durable payment intent and receipt metadata.
- `audit.tail`: tail recent audit events.

## Current implementation status

Implemented:

- TypeScript MCP backend scaffold.
- File-backed memory store with deterministic JSON canonicalization and SHA-256 hashing.
- File-backed encrypted Grimoire secret/policy store.
- File-backed audit store and audit events for memory, Grimoire, and payment policy checks.
- Durable payment intent store with idempotency keys.
- x402 HTTP 402 challenge client abstraction.
- Casper anchor client interface with a mock implementation that computes local `anchor_id` and leaves transaction hashes null.
- Contract source/spec stub under `contracts/memory-anchor/`.

Not implemented yet:

- Real Casper testnet contract build/deploy.
- Real Casper x402 signed payment and facilitator settlement from the TypeScript backend.
- SQLite/Postgres migrations; current stores are JSON files for hackathon velocity.
- Remote HTTP MCP transport.

## Verification

```bash
cd backend
npm test
npm run build
```

Current tests cover:

- Memory canonicalization, storage, search, verification, and local anchor metadata.
- Grimoire secret encryption/no plaintext exposure and stable policy hashing.
- Audit persistence and service event emission.
- Payment policy allow/deny, durable intent persistence, idempotency, and receipt lookup.
- x402 config loading and HTTP 402 challenge parsing.

## Casper contract status

`contracts/memory-anchor/` is intentionally a stub because the current environment does not have Rust, `cargo`, `cargo-casper`, or `casper-client`. The backend is already designed behind a `CasperAnchorClient` interface so the mock can be replaced by a real deploy/query client without changing MCP tool contracts.

Never store memory bodies, secrets, signed payment payloads, or private keys on-chain. The on-chain contract should store hashes only.
