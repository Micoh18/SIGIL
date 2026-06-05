---
title: Casper Anchoring
description: Current Casper anchor client boundary and memory-anchor contract readiness.
section: Core Modules
status: pending
last_verified: 2026-06-05
---

# Casper Anchoring

Mr Mainspring is designed to anchor hash-only memory proofs on Casper. The repository now contains a minimal Casper contract source and a backend interface, but not a verified real transaction submission path.

## Backend Client Modes

`createCasperAnchorClient` selects a client from environment/config:

| Mode | When Selected | Behavior |
| --- | --- | --- |
| `unconfigured` | `MEMORY_ANCHOR_CONTRACT_HASH` is absent. | Accepts validated local hash metadata and returns `pending` with `casper_contract_not_configured`. |
| `configured` | Contract hash, package hash, RPC URL, chain name, and account key path are present. | Validates config and returns `pending` with `casper_transaction_submission_not_implemented`. |

Both modes validate anchor payloads. Neither mode currently submits a Casper transaction or claims a transaction hash.

## Required Real Testnet Environment

The configured client path requires:

```bash
CASPER_RPC_URL="https://<testnet-node>:7777/rpc"
CASPER_NETWORK_NAME="casper-test"
MEMORY_ANCHOR_CONTRACT_HASH="hash-<64 hex chars>"
MEMORY_ANCHOR_PACKAGE_HASH="hash-<64 hex chars>"
CASPER_ACCOUNT_KEY_PATH="./keys/backend.pem"
```

`CASPER_CAIP2_CHAIN_ID` still defaults to `casper:casper-test` for MCP/payment metadata.

## Anchor Submission

The backend creates:

```json
{
  "anchor_id": "sha256-hex",
  "agent_id_hash": "sha256-hex",
  "memory_id_hash": "sha256-hex",
  "content_hash": "sha256-hex",
  "metadata_hash": "sha256-hex",
  "prev_anchor_hash": null
}
```

Before a real contract call, `prev_anchor_hash: null` must be encoded as an empty string. The privacy boundary is deliberate: memory bodies, secret values, signed payment payloads, and private keys must not be written on-chain.

## Contract Source

`contracts/memory-anchor/` now contains a smallest-path contract source:

```text
anchor_memory(anchor_id, agent_id_hash, memory_id_hash, content_hash, metadata_hash, prev_anchor_hash)
```

The contract stores:

```text
anchor_<anchor_id> = agent_id_hash:memory_id_hash:content_hash:metadata_hash:prev_anchor_hash
agent_latest_<agent_id_hash> = anchor_id
```

All values are hash-only. The contract rejects non-lowercase-hex hash arguments and duplicate `anchor_id` values.

::: warning Contract limitation
The contract has been locally built to Wasm, but it has not been deployed or queried on Casper testnet. Real verification still requires `casper-client`, a funded testnet account, a successful install transaction, and retrieved contract/package hashes.
:::

## Manual Build And Deploy

Prerequisites:

```bash
rustup target add wasm32-unknown-unknown
cargo install cargo-casper
cargo install casper-client
```

Build:

```bash
cd contracts/memory-anchor
cargo build --release --target wasm32-unknown-unknown
```

Optional Makefile build, if `make` is installed:

```bash
make -C contracts/memory-anchor prepare
make -C contracts/memory-anchor build-contract
make -C contracts/memory-anchor test
```

Expected Wasm artifact:

```text
contracts/memory-anchor/target/wasm32-unknown-unknown/release/sigil_memory_anchor.wasm
```

Install on testnet only after the build succeeds:

```bash
casper-client put-transaction session \
  --node-address "$CASPER_RPC_URL" \
  --chain-name "$CASPER_NETWORK_NAME" \
  --secret-key "$CASPER_ACCOUNT_KEY_PATH" \
  --gas-price-tolerance 10 \
  --pricing-mode fixed \
  --transaction-path contracts/memory-anchor/target/wasm32-unknown-unknown/release/sigil_memory_anchor.wasm \
  --session-entry-point call \
  --category "install-upgrade"

casper-client get-transaction --node-address "$CASPER_RPC_URL" "<TRANSACTION_HASH>"
```

Do not copy contract/package hashes into backend env or mark memories as `anchored` until the deploy transaction is retrieved and verified successful.
