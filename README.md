# Mr Mainspring

Mr Mainspring is a backend-only MCP server for agent infrastructure on Casper. It gives agents a local tool surface for:

- Verifiable memory: write/read/search/verify memory envelopes, compute deterministic hashes, and keep hash-only Casper anchor metadata.
- Grimoire controls: store encrypted secrets and enforce scoped spending/access policies without returning raw secret values.
- x402 pre-settlement: create durable payment intents, enforce policy first, optionally capture an HTTP 402 challenge, and stop before unverified settlement.
- Audit trail: persist local events for memory, Grimoire, payment, and anchor activity.

Some package names, environment variables, schema versions, and storage paths still use `sigil`/`SIGIL` identifiers. Treat those as stable technical identifiers, not the public project name.

## Repository Layout

```text
backend/                    TypeScript MCP backend
contracts/memory-anchor/    Casper memory-anchor hash-only contract source
docs-site/                  VitePress documentation site and generated LLM docs
docs/demo-runbook.md        Local MCP demo guide
backend-spec.md             Legacy backend product/security spec
.env.example                Local backend environment template
```

## Run the Backend

```bash
cd backend
npm install
npm test
npm run build
npm run demo:stdio
```

Run the MCP server over stdio after building:

```bash
cd backend
npm run mcp:stdio
```

For live TypeScript development:

```bash
cd backend
npm run dev
```

The backend writes local demo data under `.sigil/` unless `SIGIL_DATA_DIR` is set.

## Environment

Copy the root template and fill real values as they become available:

```bash
cp .env.example .env
```

Important values:

- `SIGIL_DATA_DIR`: local JSON-file stores for memory, Grimoire, payments, and audit. Defaults to `.sigil/`.
- `SIGIL_MCP_NAME` and `SIGIL_MCP_VERSION`: stable MCP server identifier values.
- `GRIMOIRE_MASTER_KEY`: base64-encoded 32-byte AES-GCM key. If omitted, the backend uses a deterministic local development key only.
- `X402_FACILITATOR_URL`: Casper x402 facilitator, expected at `http://localhost:4022` for the demo sidecar.
- `X402_RESOURCE_DEMO_URL`: demo paid resource, expected at `http://localhost:4021/weather`.
- `X402_ASSET_PACKAGE`: CEP-18/x402 token package hash when available.
- `CASPER_NETWORK_NAME`: Casper chain name, defaults to `casper-test`.
- `CASPER_CAIP2_CHAIN_ID`: defaults to `casper:casper-test`.
- `CASPER_RPC_URL`: Casper node RPC address required for real anchoring.
- `CASPER_ACCOUNT_KEY_PATH`: secret key path required for real anchoring.
- `MEMORY_ANCHOR_CONTRACT_HASH`: unset until a real Casper contract is deployed and verified.
- `MEMORY_ANCHOR_PACKAGE_HASH`: unset until a real Casper contract package is deployed and verified.

## Documentation

The docs site is configured for Vercel through `vercel.json`:

```text
installCommand: npm ci --prefix docs-site
buildCommand: npm run build --prefix docs-site
outputDirectory: docs-site/docs/.vitepress/dist
```

To open the docs locally:

```bash
npm install --prefix docs-site
npm run build --prefix docs-site
npm run preview --prefix docs-site
```

The preview command prints the local URL, normally `http://127.0.0.1:4173/`. The generated LLM-readable entry points are available at `/llms.txt`, `/llms-full.txt`, and `/api/tool-schemas.json` in the docs site.

## Current MCP Tools

- `memory.write`: store a memory envelope, content hash, metadata hash, and optional local Casper anchor metadata.
- `memory.read`: read one memory by `agent_id` and `memory_id`.
- `memory.search`: search stored memories for an agent in the local store.
- `memory.verify`: recompute local hashes and report stored anchor metadata.
- `grimoire.secret.put`: encrypt and store a scoped secret. Plaintext is never returned.
- `grimoire.secret.list`: list secret metadata only.
- `grimoire.policy.set`: create or update an allowlisted spending/access policy.
- `grimoire.policy.get`: read policy metadata and local spend fields.
- `payment.fetch`: create a durable x402 payment intent after policy checks. Without settlement, it returns `status: policy_checked`, `next_state: challenge_received`, and `settlement: not_started`. With `request_challenge: true`, it makes the first HTTP request and persists any 402 requirements without claiming settlement.
- `payment.receipt`: read persisted payment intent and receipt metadata.
- `audit.tail`: tail recent audit events.

## Real Today

- TypeScript MCP backend with stdio transport.
- File-backed JSON stores for memory, Grimoire secrets/policies, payments, and audit.
- Deterministic JSON canonicalization and SHA-256 memory hashing.
- Encrypted Grimoire secret storage with metadata-only tool responses.
- Spending/access policy enforcement before x402 payment intent creation.
- Durable payment intent persistence with idempotency keys.
- Optional first HTTP 402 challenge capture for `payment.fetch`.
- Audit events for memory, Grimoire, payment policy checks, and verification flows.
- Casper anchor client interface with a local placeholder path that creates deterministic `anchor_id` values and leaves transaction hashes null.
- Hash-only contract source under `contracts/memory-anchor/`.

## Not Implemented Yet

- Verified Casper testnet contract build, deploy, or transaction submission.
- Real Casper x402 signed payment payload creation, facilitator verification, or settlement from the TypeScript backend.
- A production-hardened Casper memory-anchor contract with deployed testnet hashes.
- SQLite/Postgres migrations; current stores are JSON files for local velocity.
- Remote HTTP MCP transport.
- A frontend application. The public site is documentation only.

Mr Mainspring should keep returning honest pre-settlement and pending-anchor states until those paths are implemented and verified. It should not fake Casper transaction hashes, signed payment payloads, or settlement receipts.

## Verification

Requested verification commands:

```bash
cd backend
npm test
npm run build

cd ..
npm run build --prefix docs-site
git status --short
```

Current tests cover memory canonicalization, storage, search, verification, local anchor metadata, Grimoire secret encryption/no plaintext exposure, policy hashing, audit persistence, payment policy allow/deny, durable intent persistence, idempotency, receipt lookup, x402 config loading, and HTTP 402 challenge parsing.

## Casper Contract Status

`contracts/memory-anchor/` now contains a minimal hash-only Casper contract source. It builds locally to Wasm with stable Rust and the `wasm32-unknown-unknown` target. It was not deployed in this environment because `casper-client` is not installed and no funded Casper testnet account or contract/package hashes were verified.

Never store memory bodies, secrets, signed payment payloads, or private keys on-chain. The on-chain contract should store hashes only.

Manual contract prerequisites:

```bash
rustup target add wasm32-unknown-unknown
cargo install cargo-casper
cargo install casper-client
cd contracts/memory-anchor
cargo build --release --target wasm32-unknown-unknown
```
