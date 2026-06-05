---
title: Current Limitations
description: Honest current gaps in SIGIL's Casper contract, x402 settlement, persistence, and transport story.
section: Reference
status: current
last_verified: 2026-06-05
---

# Current Limitations

SIGIL is usable as a local MCP backend, but several production and demo-completion paths remain intentionally unfinished.

## Casper

- The memory-anchor contract under `contracts/memory-anchor/` is a stub.
- Rust/Casper build and deploy verification are not represented by the current contract source.
- Backend anchoring returns pending metadata and null Casper transaction hashes.
- A configured anchor client still returns `casper_transaction_submission_not_implemented`.

## x402

- The backend can request and persist an HTTP 402 challenge.
- The backend can hash free or unexpected non-402 responses.
- The backend does not create signed x402 payment payloads.
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

## Demo Blockers

To complete the full intended demo, the project still needs:

```text
Rust/Casper contract tooling
buildable memory_anchor contract
funded Casper testnet account
deployed CEP-18 x402 token package
running make-software/casper-x402 facilitator
verified payment settlement path
real Casper transaction hash capture
```
