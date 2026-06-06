# Mr Mainspring

Mr Mainspring combines a copied landing frontend with a local MCP server for agent infrastructure on Casper. The backend gives agents a local tool surface for:

- Verifiable memory: write/read/search/verify memory envelopes, compute deterministic hashes, and keep hash-only Casper anchor metadata.
- Grimoire controls: store encrypted secrets and enforce scoped spending/access policies without returning raw secret values.
- x402 payments: create durable payment intents, enforce policy first, capture HTTP 402 challenges, and optionally call a configured signer sidecar to retry with `PAYMENT-SIGNATURE` before accepting a verified `PAYMENT-RESPONSE`.
- Audit trail: persist local events for memory, Grimoire, payment, and anchor activity.

Some package names, environment variables, schema versions, and storage paths still use `sigil`/`SIGIL` identifiers. Treat those as stable technical identifiers, not the public project name.

## Repository Layout

```text
backend/                    TypeScript MCP backend
contracts/memory-anchor/    Casper memory-anchor hash-only contract source
mainspring-front/           Coworker-provided landing frontend handoff copied into the repo
docs-site/                  VitePress documentation site and generated LLM docs
docs/demo-runbook.md        Local MCP demo guide
docs/casper-x402-runbook.md Real Casper x402 settlement runbook
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

## x402: Local Simulation vs Real Casper Settlement

The local evaluator demo and the real Casper x402 smoke are intentionally
separate.

The scripted local MCP demo proves policy checks, durable payment intents,
receipts, and audit events without paying on-chain:

```bash
npm run demo:stdio --prefix backend
```

Expected payment line:

```text
PASS payment.fetch: allowed=true status=policy_checked next_state=challenge_received settlement=not_started payment_id=<pay_...>
```

For local paid-resource challenge wiring, start the resource sidecar:

```bash
npm run demo:x402-sidecars --prefix backend
```

This exposes `http://localhost:4021/weather`. The first request returns `402 Payment Required` with `PAYMENT-REQUIRED`; paid retries must include `PAYMENT-SIGNATURE`. The resource calls the configured Casper x402 facilitator `/verify` and `/settle`, returns the protected response only after settlement verifies, and attaches `PAYMENT-RESPONSE` only when the facilitator returns a Casper transaction hash.

The clearer alias is:

```bash
npm run x402:resource --prefix backend
```

Without `X402_SIGNER_URL`, the resource smoke proves only the 402 challenge:

```bash
npm run demo:x402-sidecars:smoke --prefix backend
```

Expected:

```text
PASS x402 paid resource smoke: challenge=402 payment_required=true
Set X402_SIGNER_URL to run the full paid retry smoke.
```

For real Casper testnet settlement, configure `.env` with at least:

```env
CASPER_RPC_URL=https://node.testnet.casper.network/rpc
CASPER_ACCOUNT_KEY_PATH=<absolute-path-outside-repo>/backend.pem
CASPER_ENABLE_REAL_SUBMISSION=true
X402_ENABLE_REAL_SETTLEMENT=true
X402_SETTLEMENT_MODE=resource-retry
X402_FACILITATOR_URL=http://127.0.0.1:4022
X402_RESOURCE_DEMO_URL=http://127.0.0.1:4021/weather
X402_RESOURCE_AMOUNT=2500000000
X402_ASSET_ID=casper-native-cspr
X402_BUYER_ACCOUNT_HASH=account-hash-d0a57c6a95e74463de156cac761e17f0923eafc730ce3ce3a0c747c6598b0500
X402_BUYER_PRIVATE_KEY_PATH=<absolute-path-outside-repo>/backend.pem
X402_PAY_TO=02032878c27882713870adf0e7546a082e991147824e77b710aaa77f47c6d972b041
X402_SIGNER_URL=http://127.0.0.1:4030/sign
X402_PAYMENT_HEADER_NAME=PAYMENT-SIGNATURE
```

Native CSPR uses integer motes. `2500000000` is 2.5 CSPR.

For the real Casper signer sidecar, keep the buyer private key outside this repository and run:

```bash
npm run x402:signer --prefix backend
```

Set `X402_SIGNER_URL=http://127.0.0.1:4030/sign` for the MCP backend.

For the Casper x402 facilitator sidecar, configure Casper RPC/account settings and run:

```bash
npm run x402:facilitator --prefix backend
```

It exposes `POST /verify` and `POST /settle` on `http://127.0.0.1:4022` by default. `/verify` validates the signed payload and reserves the nonce; `/settle` submits the Casper settlement path and returns `settled: true` only after execution succeeds.

To prove the full MCP-driven flow, run the real-settlement smoke:

```bash
npm run smoke:x402-payment-fetch --prefix backend
```

The smoke starts local x402 sidecars by default, sets a Grimoire policy matching `X402_RESOURCE_DEMO_URL`/`X402_RESOURCE_AMOUNT`/`X402_PAY_TO`, calls `payment.fetch` with `request_challenge=true`, then verifies `payment.receipt`, audit events, policy spend, and a Casper transaction hash. Set `X402_SMOKE_START_SIDECARS=false` to use already-running sidecars.

Expected success transcript:

```text
Mr Mainspring Casper x402 payment.fetch smoke
resource=http://127.0.0.1:4021/weather
policy_id=pol-casper-x402-smoke-<timestamp>
PASS payment.fetch: status=settled settlement=settled payment_id=pay_<hex>
PASS payment.receipt: settlement_status=settled casper_transaction_hash=<64-hex>
PASS policy.spend: before=0 after_preflight=0 after_settlement=2500000000
PASS audit.tail: events=payment.challenge_received,payment.settled,policy.spend_recorded
RESULT PASS
```

Verify the transaction hash with Casper:

```bash
casper-client get-transaction \
  --node-address https://node.testnet.casper.network/rpc \
  <casper_transaction_hash>
```

The returned transaction must include execution info and no `Failure` or `error_message`. See `docs/casper-x402-runbook.md` for the full `.env`, manual sidecar run, expected outputs, and failure-state table.

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
- `X402_FACILITATOR_HOST` and `X402_FACILITATOR_PORT`: facilitator sidecar bind address. Defaults to `127.0.0.1:4022`.
- `X402_RESOURCE_DEMO_URL`: demo paid resource, expected at `http://localhost:4021/weather`.
- `X402_ASSET_ID`: first real settlement asset identifier. Current testnet value is `casper-native-cspr`.
- `X402_ASSET_PACKAGE`: CEP-18/x402 token package hash when available.
- `X402_ASSET_DECIMALS` and `X402_AMOUNT_UNIT`: native CSPR uses `9` decimals and `mote` transaction units.
- `X402_RESOURCE_AMOUNT` and `X402_RESOURCE_TIMEOUT_SECONDS`: paid resource requirement amount and signature validity window. Native CSPR amounts are integer motes.
- `X402_BUYER_PUBLIC_KEY` and `X402_BUYER_ACCOUNT_HASH`: non-secret buyer identifiers.
- `X402_BUYER_PRIVATE_KEY_PATH`: signer-side only. Must point outside this repository; the MCP backend does not read it.
- `X402_PAYEE_PUBLIC_KEY`, `X402_PAYEE_ACCOUNT_HASH`, and `X402_PAY_TO`: non-secret merchant/payee identifiers. `X402_PAY_TO` should match the protected resource requirement.
- `X402_ENABLE_REAL_SETTLEMENT`: must be `true` before the backend should wire a real settlement provider. Defaults to disabled.
- `X402_SETTLEMENT_MODE`: `resource-retry` by default. Use `facilitator` only for server-side facilitator verification/settlement tests.
- `X402_SIGNER_URL`: external signer sidecar URL. Required for real settlement. The backend sends approved requirements and expects a signed x402 `PaymentPayload`.
- `X402_SIGNER_HOST` and `X402_SIGNER_PORT`: signer sidecar bind address. Defaults to `127.0.0.1:4030`.
- `X402_SIGNER_AUTH_TOKEN`: optional bearer token for the signer sidecar.
- `X402_SIGNER_TIMEOUT_MS`: signer request timeout. Defaults to `10000`.
- `X402_SIGNER_MAX_VALIDITY_SECONDS`: upper bound for signed payload validity. Defaults to `900`.
- `X402_PAYMENT_HEADER_NAME`: payment header used for paid resource retry. Defaults to `PAYMENT-SIGNATURE`.
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
- `payment.fetch`: create a durable x402 payment intent after policy checks. Without challenge, it returns `status: policy_checked`, `next_state: challenge_received`, and `settlement: not_started`. With `request_challenge: true`, it makes the first HTTP request, persists any 402 requirements, validates them against policy, and either stops with `settlement_unavailable` or, when real settlement is enabled and a signer sidecar is configured, retries the paid resource with `PAYMENT-SIGNATURE` and persists only verified settlement receipts.
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
- Optional first HTTP 402 challenge capture for `payment.fetch`, requirement approval, external signer-sidecar integration, paid resource retry, `PAYMENT-RESPONSE` verification, and disabled/failed/settled receipt persistence.
- Repo-local Casper x402 signer, paid resource, facilitator, and full `payment.fetch` smoke scripts for native CSPR testnet settlement when the required env and funded key are provided.
- Audit events for memory, Grimoire, payment policy checks, and verification flows.
- Casper anchor client interface with a local pending path and an optional real `casper-client put-transaction package` submission path behind `CASPER_ENABLE_REAL_SUBMISSION`.
- Hash-only Casper memory-anchor contract deployed on testnet.

## Not Implemented Yet

- Automatic Casper transaction execution verification and on-chain query for memory anchors. The x402 facilitator settlement path does poll `casper-client get-transaction` before accepting a settlement.
- Native in-process Casper x402 payment signing inside the MCP backend. Real x402 signing must come from the standalone signer sidecar or another external signer until a Casper-compatible SDK/facilitator is pinned and verified.
- Pinned external/public Casper x402 facilitator support. The repo-local facilitator is the verified native CSPR testnet path for this milestone.
- Production hardening around contract upgrades, key custody, and automatic finality checks.
- Full relational SQLite/Postgres domain migrations; Supabase currently stores domain records as JSONB with indexed lookup columns.
- Remote HTTP MCP transport.

Mr Mainspring should keep returning honest unavailable-settlement and pending-anchor states unless the external x402 signer/resource/facilitator path or Casper anchor verification path is actually configured and verified. It should not fake verified Casper execution, signed payment payloads, or settled receipts.

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

Current tests cover memory canonicalization, storage, search, verification, local anchor metadata, optional Casper CLI submission command construction, Grimoire secret encryption/no plaintext exposure, policy hashing, audit persistence, payment policy allow/deny, durable intent persistence, idempotency, receipt lookup, x402 config loading, HTTP 402 challenge parsing, external signer wiring, paid resource retry, `PAYMENT-RESPONSE` verification, policy spend updates after verified settlement, and disabled/failed/verified settlement boundaries.

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
