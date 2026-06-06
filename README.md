# Mr Mainspring

Mr Mainspring combines a copied landing frontend with a local MCP server for agent infrastructure on Casper. The backend gives agents a local tool surface for:

- Verifiable memory: write/read/search/verify memory envelopes, compute deterministic hashes, and keep hash-only Casper anchor metadata.
- Grimoire controls: store encrypted secrets and enforce scoped spending/access policies without returning raw secret values.
- x402 pre-settlement: create durable payment intents, enforce policy first, optionally capture an HTTP 402 challenge, and stop before unverified settlement.
- Audit trail: persist local events for memory, Grimoire, payment, and anchor activity.

Some package names, environment variables, schema versions, and storage paths still use `sigil`/`SIGIL` identifiers. Treat those as stable technical identifiers, not the public project name.

## Repository Layout

```text
backend/                    TypeScript MCP backend
contracts/memory-anchor/    Casper memory-anchor hash-only contract source
mainspring-front/           Coworker-provided landing frontend handoff copied into the repo
docs-site/                  VitePress documentation site and generated LLM docs
docs/demo-runbook.md        Local MCP demo guide
backend-spec.md             Legacy backend product/security spec
.env.example                Local backend environment template
```

## Run the Frontend

The coworker frontend is copied as-is under `mainspring-front/`. The runnable static page is `mainspring-front/project/index.html`.

```bash
npm run front:dev
```

This serves the copied frontend at `http://127.0.0.1:4177/`.

To assemble the deployable public site:

```bash
npm run front:build
```

To build the frontend root plus the docs under `/docs`:

```bash
npm run build
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
- `SIGIL_ENV_FILE`: optional explicit path to a local env file. If unset, the backend checks `.env` in the current/backend/repo root paths.
- `SIGIL_MCP_NAME` and `SIGIL_MCP_VERSION`: stable MCP server identifier values.
- `SIGIL_STORAGE_BACKEND`: `file` by default. Set `supabase` after applying `backend/supabase/schema.sql`.
- `PROJECT_URL`: Supabase project URL for optional remote persistence.
- `SECRET_KEY` or `PUBLISHABLE_KEY`: key used for Supabase REST calls. Prefer `SECRET_KEY` only in local env/secret manager.
- `SUPABASE_DB_SCHEMA`: defaults to `public`.
- `SUPABASE_TABLE_PREFIX`: defaults to `sigil_`.
- `GRIMOIRE_MASTER_KEY`: base64-encoded 32-byte AES-GCM key. If omitted, the backend uses a deterministic local development key only.
- `X402_FACILITATOR_URL`: Casper x402 facilitator, expected at `http://localhost:4022` for the demo sidecar.
- `X402_RESOURCE_DEMO_URL`: demo paid resource, expected at `http://localhost:4021/weather`.
- `X402_ASSET_PACKAGE`: CEP-18/x402 token package hash when available.
- `X402_ENABLE_REAL_SETTLEMENT`: must be `true` before the backend should wire a real settlement provider. Defaults to disabled.
- `CASPER_NETWORK_NAME`: Casper chain name, defaults to `casper-test`.
- `CASPER_CAIP2_CHAIN_ID`: defaults to `casper:casper-test`.
- `CASPER_RPC_URL`: Casper node RPC address required for real anchoring.
- `CASPER_ACCOUNT_KEY_PATH`: secret key path required for real anchoring.
- `CASPER_ENABLE_REAL_SUBMISSION`: must be `true` before the backend shells out to `casper-client`.
- `CASPER_CLIENT_BIN`: Casper CLI executable name or path. Defaults to `casper-client`.
- `CASPER_CLIENT_WSL_DISTRO`: optional Windows helper. Set to `Ubuntu` to run `wsl -d Ubuntu -- casper-client ...`.
- `CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES`: standard payment amount for anchor calls. Defaults to `3000000000`.
- `MEMORY_ANCHOR_CONTRACT_HASH`: deployed memory-anchor contract hash.
- `MEMORY_ANCHOR_PACKAGE_HASH`: deployed memory-anchor package hash.

## Documentation

The public site is configured for Vercel through `vercel.json`:

```text
installCommand: npm ci --prefix docs-site
buildCommand: npm run build
outputDirectory: dist
```

The copied frontend is deployed at `/`. The docs build is copied under `/docs`.

To open only the docs locally:

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
- `payment.fetch`: create a durable x402 payment intent after policy checks. Without challenge, it returns `status: policy_checked`, `next_state: challenge_received`, and `settlement: not_started`. With `request_challenge: true`, it makes the first HTTP request, persists any 402 requirements, validates them against policy, and defaults to `settlement_unavailable` until real settlement is configured.
- `payment.receipt`: read persisted payment intent and receipt metadata.
- `audit.tail`: tail recent audit events.

## Real Today

- TypeScript MCP backend with stdio transport.
- File-backed JSON stores for memory, Grimoire secrets/policies, payments, and audit.
- Optional Supabase persistence through PostgREST-compatible tables in `backend/supabase/schema.sql`.
- Deterministic JSON canonicalization and SHA-256 memory hashing.
- Encrypted Grimoire secret storage with metadata-only tool responses.
- Spending/access policy enforcement before x402 payment intent creation.
- Durable payment intent persistence with idempotency keys.
- Optional first HTTP 402 challenge capture for `payment.fetch`, requirement approval, and disabled-provider settlement receipts.
- Audit events for memory, Grimoire, payment policy checks, and verification flows.
- Casper anchor client interface with a local pending path and an optional real `casper-client put-transaction package` submission path behind `CASPER_ENABLE_REAL_SUBMISSION`.
- Hash-only Casper memory-anchor contract deployed on testnet.

## Not Implemented Yet

- Automatic Casper transaction execution verification and on-chain query from the TypeScript backend.
- Real Casper x402 signed payment payload creation, paid retry, facilitator verification, or settlement from the TypeScript backend.
- Production hardening around contract upgrades, key custody, and automatic finality checks.
- Full relational SQLite/Postgres domain migrations; Supabase currently stores domain records as JSONB with indexed lookup columns.
- Remote HTTP MCP transport.

Mr Mainspring should keep returning honest pre-settlement, unavailable-settlement, and pending-anchor states until those paths are implemented and verified. It should not fake verified Casper execution, signed payment payloads, or settled receipts.

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

Current tests cover memory canonicalization, storage, search, verification, local anchor metadata, optional Casper CLI submission command construction, Grimoire secret encryption/no plaintext exposure, policy hashing, audit persistence, payment policy allow/deny, durable intent persistence, idempotency, receipt lookup, x402 config loading, HTTP 402 challenge parsing, and disabled/verified settlement provider boundaries.

## Casper Contract Status

`contracts/memory-anchor/` contains a minimal hash-only Casper contract source. It builds to Wasm with stable Rust and the `wasm32-unknown-unknown` target using repo Cargo flags that disable unsupported Wasm bulk-memory operations.

Verified testnet deployment:

```text
deploy_transaction=3b8f624ef1d5960a8cf724811c0c68c51dff8809fa1128f69a2c7077afdcbc09
MEMORY_ANCHOR_CONTRACT_HASH=hash-9a10301e16f0871c57cf584810848d9eb859ba2c8c168fdf1cd7bdef99cb32df
MEMORY_ANCHOR_PACKAGE_HASH=hash-162da01355500a4ec1e715cfab6e5f3f12ee8cc57b3d23c444f377ad4014c98c
```

Verified backend anchor submission:

```text
anchor_transaction=91fb904e47b600b0a9e4f6571a3412c83187000e9ceab19ba26cc23fabec555c
execution_error=null
```

Never store memory bodies, secrets, signed payment payloads, or private keys on-chain. The on-chain contract should store hashes only.

Manual contract prerequisites:

```bash
rustup target add wasm32-unknown-unknown
cargo install cargo-casper
cargo install casper-client
cd contracts/memory-anchor
cargo build --release --target wasm32-unknown-unknown
```
