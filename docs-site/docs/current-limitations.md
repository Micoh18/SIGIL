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
- A paid request was replayed successfully unless the real signer/resource/facilitator path is configured and returns a verifiable `PAYMENT-RESPONSE`.
- Facilitator settlement was verified unless the selected resource/facilitator pair returns a settlement response with a transaction hash.
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
- The backend has a settlement-provider interface for external signing, paid resource retry, facilitator `/verify`, facilitator `/settle`, and receipt persistence.
- The default production wiring keeps settlement disabled and persists an explicit `settlement_unavailable` receipt.
- The backend can call an external signer sidecar through `X402_SIGNER_URL`, retry the paid resource with `PAYMENT-SIGNATURE`, and verify `PAYMENT-RESPONSE`.
- The backend does not read private keys or create native in-process Casper x402 signatures.
- The backend does not include a pinned Casper-compatible x402 SDK/facilitator yet.
- The backend must not claim real Casper x402 settlement until the signer/resource/facilitator path is run and verified for the selected `(scheme, network)` pair.

## Persistence

- Default stores are JSON files under `SIGIL_DATA_DIR`.
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
- Period spend updates are applied after verified settlement only; full pre-checking against already-used period budget still needs to be added.
- Signed payloads are not returned through MCP outputs. The backend stores only `signed_payload_hash`.
- Payment requirement redaction is implemented for MCP outputs, but full paid-request replay still needs signed payload redaction rules.

## Demo Blockers

To complete the full intended demo, the project still needs:

```text
casper-client available to the backend runtime
funded Casper testnet account for future anchors
configured deployed memory_anchor contract/package hashes
deployed CEP-18 x402 token package
running make-software/casper-x402 facilitator
external wallet/KMS or encrypted Grimoire reference for the x402 client signing key
configured X402_SIGNER_URL sidecar that returns signed PaymentPayload JSON
configured facilitator /verify and /settle endpoints for the selected scheme/network
Grimoire allowlist for resource URL, method, amount, network, asset package, payee, and scheme
verified payment settlement path
real x402 Casper transaction hash capture
automatic Casper transaction execution verification
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
