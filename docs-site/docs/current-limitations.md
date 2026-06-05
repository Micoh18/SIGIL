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
- Memory hashes and local verification work for stored records.
- Grimoire stores encrypted secrets and returns metadata only.
- Payment policy preflight and optional first x402 challenge capture work.
- Audit events provide a redacted local story.

A passing local demo does not mean:

- A Casper transaction was submitted or verified.
- x402 payment authorization was signed.
- A paid request was replayed successfully.
- Facilitator settlement was verified.
- Production database, migration, KMS, or remote transport paths exist.

## Casper

- The memory-anchor contract under `contracts/memory-anchor/` is hash-only source and builds locally to Wasm, but it has not been deployed or queried on Casper testnet.
- Contract integration tests are not present yet; only the Wasm build has been verified.
- Backend anchoring returns pending metadata and null Casper transaction hashes.
- A configured anchor client still returns `casper_transaction_submission_not_implemented`.
- Real testnet use requires `CASPER_RPC_URL`, `CASPER_NETWORK_NAME`, `MEMORY_ANCHOR_CONTRACT_HASH`, `MEMORY_ANCHOR_PACKAGE_HASH`, and `CASPER_ACCOUNT_KEY_PATH`.

## x402

- The backend can request and persist an HTTP 402 challenge.
- The backend can hash free or unexpected non-402 responses.
- The backend can validate captured payment requirements against policy before the future signing boundary.
- The backend does not create signed x402 payment payloads.
- The backend does not call facilitator `/verify`.
- The backend does not call facilitator `/settle`.
- The backend does not replay paid requests with payment authorization.
- The backend does not verify facilitator settlement.
- The backend must not claim real Casper x402 settlement until the facilitator is run and verified.

## Persistence

- Current stores are JSON files under `SIGIL_DATA_DIR`.
- SQLite/Postgres schemas from the product spec are not implemented.
- There are no migrations yet.

## Transport

- MCP stdio is implemented.
- Remote HTTP MCP transport is not implemented.
- Local HTTP API endpoints from the product spec are not implemented.

## Security Hardening

- Local `GRIMOIRE_MASTER_KEY` management is environment-variable based.
- KMS/HSM integration is not implemented.
- Period spend updates depend on real settlement and are not complete.
- Signed payload storage/redaction rules are reserved for future settlement work.
- Payment requirement redaction is implemented for MCP outputs, but full paid-request replay still needs signed payload redaction rules.

## Demo Blockers

To complete the full intended demo, the project still needs:

```text
cargo-casper and casper-client
funded Casper testnet account
deployed memory_anchor contract/package hashes
deployed CEP-18 x402 token package
running make-software/casper-x402 facilitator
external wallet/KMS or encrypted Grimoire reference for the x402 client signing key
configured facilitator /verify and /settle endpoints for the selected scheme/network
Grimoire allowlist for resource URL, method, amount, network, asset package, payee, and scheme
verified payment settlement path
real Casper transaction hash capture
```

## Verification Commands

Use these checks when reviewing this milestone:

```bash
npm.cmd run docs:llms --prefix docs-site
npm.cmd run build --prefix docs-site
npm test --prefix backend
npm run build --prefix backend
```

Then run the scripted [Local Demo](/local-demo) with `npm run demo:stdio --prefix backend`, or exercise the same tools through an MCP client. The correct current result is a working local pre-settlement flow, not a settled payment or anchored Casper transaction.
