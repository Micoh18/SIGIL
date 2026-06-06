---
title: Current Limitations
description: Honest current gaps in Mr Mainspring's Casper contract, x402 settlement, persistence, and transport story.
section: Reference
status: current
last_verified: 2026-06-05
---

# Current Limitations

Mr Mainspring is usable as a local MCP backend, but several production and demo-completion paths remain intentionally unfinished.

## How to Read a Passing Local Demo

A passing backend test run, docs build, and local MCP demo mean:

- The implemented MCP tools validate inputs and persist local JSON records.
- Optional Supabase persistence can store the same records remotely once the included SQL schema is applied.
- Memory hashes and local verification work for stored records.
- Grimoire stores encrypted secrets and returns metadata only.
- Payment policy preflight and optional first x402 challenge capture work.
- Audit events provide a redacted local story.

A passing local demo does not mean:

- A Casper transaction was submitted by the scripted local demo.
- A submitted Casper transaction was automatically verified for final execution by the backend.
- x402 payment authorization was signed unless `X402_ENABLE_REAL_SETTLEMENT=true` and `X402_SIGNER_URL` point to a real signer sidecar.
- Replay protection is durable across restarts or multiple sidecar instances. The repo-local resource and facilitator reject duplicate payloads and nonce replays in-process only.
- Facilitator settlement was verified unless the selected resource/facilitator pair returns a settlement response with a transaction hash.
- A real native CSPR settlement happened; use [Casper x402 Runbook](/casper-x402-runbook) and verify the transaction hash separately.
- Production database, migration, KMS, or remote transport paths exist.

## Casper

- The memory-anchor contract under `contracts/memory-anchor/` is hash-only source, builds locally to Wasm, and has a verified Casper testnet deployment.
- Contract integration tests are not present yet; Wasm build, testnet deploy, and one backend `anchor_memory` smoke transaction have been verified.
- Backend anchoring without contract config returns pending metadata and null Casper transaction hashes.
- A configured anchor client can submit `anchor_memory` with `casper-client put-transaction package` only when `CASPER_ENABLE_REAL_SUBMISSION=true`, and records a transaction hash only when the CLI returns one.
- Backend anchoring does not yet run `get-transaction`, verify execution success, or query the stored on-chain anchor record.
- Real testnet use requires `CASPER_RPC_URL`, `CASPER_NETWORK_NAME`, `MEMORY_ANCHOR_CONTRACT_HASH`, `MEMORY_ANCHOR_PACKAGE_HASH`, `CASPER_ACCOUNT_KEY_PATH`, and `CASPER_ENABLE_REAL_SUBMISSION=true`.

## x402

- The backend can request and persist an HTTP 402 challenge.
- The backend can hash free or unexpected non-402 responses.
- The backend can validate captured payment requirements against policy before the settlement boundary.
- The backend checks current period spend before requesting a signature for the selected x402 requirement.
- The backend has a settlement-provider interface for external signing, paid resource retry, facilitator `/verify`, facilitator `/settle`, and receipt persistence.
- The default production wiring keeps settlement disabled and persists an explicit `settlement_unavailable` receipt.
- The backend can call an external signer sidecar through `X402_SIGNER_URL`, retry the paid resource with `PAYMENT-SIGNATURE`, and verify `PAYMENT-RESPONSE`.
- Signed payment payloads are checked for validity windows before resource retry or Casper settlement. The resource/facilitator sidecars reject stale payloads, duplicate payloads, wrong payee, wrong amount, wrong asset, wrong network, and wrong resource.
- The repo-local signer, resource, facilitator, and `smoke:x402-payment-fetch` scripts can verify native CSPR x402 settlement on Casper testnet when the runbook env and funded key are provided.
- The backend does not read private keys or create native in-process Casper x402 signatures.
- The backend does not include a pinned external/public Casper-compatible x402 facilitator yet.
- The backend must not claim real Casper x402 settlement from the local demo; only the runbook smoke plus transaction hash verification proves it for the selected `(scheme, network)` pair.

## Persistence

- Default stores are JSON files under the user's Mr Mainspring app data directory. `SIGIL_DATA_DIR` can override that location.
- Optional Supabase persistence is implemented through REST and `backend/supabase/schema.sql`.
- Supabase stores current domain records as JSONB with lookup columns. This is not the final normalized production schema.
- SQLite/Postgres schemas from the product spec are not implemented.
- There is no migration runner yet; Supabase setup is a manual SQL step.

## Transport

- MCP stdio is implemented.
- Remote HTTP MCP transport is not implemented.
- Local HTTP API endpoints from the product spec are not implemented.

## Security Hardening

- Local `GRIMOIRE_MASTER_KEY` management is environment-variable based.
- KMS/HSM integration is not implemented.
- Period spend is checked against current-period usage before signing and recorded after verified settlement. The local stores do not yet provide an atomic cross-process spend reservation.
- Signed payloads are not returned through MCP outputs. The backend stores only `signed_payload_hash`.
- Receipts, audit events, and command receipts redact raw signatures, authorization payloads, bearer tokens, private keys, public signing keys, and secret-key paths.
- Replay storage for the repo-local sidecars is in-process only; production deployments need a durable shared nonce/replay store with expiry.

## Demo Blockers

To complete the full intended demo, the project still needs:

```text
casper-client available to the backend runtime
funded Casper testnet account for anchors and x402 native CSPR settlement
configured deployed memory_anchor contract/package hashes
deployed CEP-18 x402 token package only if the selected resource uses CEP-18 instead of native CSPR
external wallet/KMS or encrypted Grimoire reference for production x402 client signing
configured X402_SIGNER_URL sidecar that returns signed PaymentPayload JSON
configured facilitator /verify and /settle endpoints for the selected scheme/network
Grimoire allowlist for resource URL, method, amount, network, asset package, payee, and scheme
verified payment settlement path
real x402 Casper transaction hash capture
automatic Casper transaction execution verification for memory anchors
```

## Verification Commands

Use these checks when reviewing this milestone:

```bash
npm.cmd run docs:llms --prefix docs-site
npm.cmd run build --prefix docs-site
npm test --prefix backend
npm run build --prefix backend
```

Then run the scripted [Local Demo](/local-demo) with `npm run demo:stdio --prefix backend`, or exercise the same tools through an MCP client. The correct default result is a working local pre-settlement flow, not a settled payment or anchored Casper transaction. Real Casper transaction submission requires the deployed contract hashes and Casper CLI environment described in [Casper Anchoring](/casper-anchoring).
