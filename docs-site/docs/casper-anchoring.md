---
title: Casper Anchoring
description: Current Casper anchor client boundary and memory-anchor contract readiness.
section: Core Modules
status: current
last_verified: 2026-06-05
---

# Casper Anchoring

Mr Mainspring anchors hash-only memory proofs on Casper. The repository contains a minimal Casper contract source, verified testnet deployment metadata, and a backend submission boundary. The backend can call `casper-client` when explicitly enabled, but it still does not verify execution/finality on its own.

## Backend Client Modes

`createCasperAnchorClient` selects a client from environment/config:

| Mode | When Selected | Behavior |
| --- | --- | --- |
| `unconfigured` | `MEMORY_ANCHOR_CONTRACT_HASH` is absent. | Accepts validated local hash metadata and returns `pending` with `casper_contract_not_configured`. |
| `configured` | Contract hash, package hash, RPC URL, chain name, and account key path are present. | Returns `pending` until `CASPER_ENABLE_REAL_SUBMISSION=true`. When enabled, runs `casper-client put-transaction package` for `anchor_memory` and stores the returned transaction hash. It returns `failed` if the CLI fails or no hash can be parsed. |

Both modes validate anchor payloads. The configured path shells out through an injectable command runner so tests never make live network calls.

## Required Real Testnet Environment

The configured client path requires:

```bash
CASPER_RPC_URL="https://<testnet-node>:7777/rpc"
CASPER_NETWORK_NAME="casper-test"
MEMORY_ANCHOR_CONTRACT_HASH="hash-9a10301e16f0871c57cf584810848d9eb859ba2c8c168fdf1cd7bdef99cb32df"
MEMORY_ANCHOR_PACKAGE_HASH="hash-162da01355500a4ec1e715cfab6e5f3f12ee8cc57b3d23c444f377ad4014c98c"
CASPER_ACCOUNT_KEY_PATH="./keys/backend.pem"
CASPER_ENABLE_REAL_SUBMISSION="true"
```

`CASPER_CAIP2_CHAIN_ID` still defaults to `casper:casper-test` for MCP/payment metadata.
`MEMORY_ANCHOR_PACKAGE_HASH` also accepts `package-<64 hex chars>` and raw lowercase hex, but the backend normalizes it to `hash-<hex>` for the legacy `--contract-package-hash` flag used by `casper-client put-transaction package`.

Optional command tuning:

```bash
CASPER_CLIENT_BIN="casper-client"
CASPER_CLIENT_WSL_DISTRO=""
CASPER_ANCHOR_SUBMISSION_MODE="transaction-package"
CASPER_GAS_PRICE_TOLERANCE="10"
CASPER_PRICING_MODE="classic"
CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES="3000000000"
```

On Windows, Mainspring auto-detects a WSL distro that can run `casper-client` when no native Windows binary is available. The backend then invokes `wsl -d <distro> -- <resolved-casper-client> ...` and converts `CASPER_ACCOUNT_KEY_PATH` to a `/mnt/<drive>/...` path. Set `CASPER_CLIENT_WSL_DISTRO` only when you need to force a specific distro.

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

The configured backend call is equivalent to:

```bash
casper-client put-transaction package \
  --node-address "$CASPER_RPC_URL" \
  --chain-name "$CASPER_NETWORK_NAME" \
  --contract-package-hash "$MEMORY_ANCHOR_PACKAGE_HASH" \
  --session-entry-point anchor_memory \
  --gas-price-tolerance 10 \
  --pricing-mode classic \
  --payment-amount "$CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES" \
  --standard-payment true \
  --secret-key "$CASPER_ACCOUNT_KEY_PATH" \
  --session-args-json '[{"name":"anchor_id","type":"String","value":"<anchor_id>"},{"name":"agent_id_hash","type":"String","value":"<agent_id_hash>"},{"name":"memory_id_hash","type":"String","value":"<memory_id_hash>"},{"name":"content_hash","type":"String","value":"<content_hash>"},{"name":"metadata_hash","type":"String","value":"<metadata_hash>"},{"name":"prev_anchor_hash","type":"String","value":"<prev_anchor_hash_or_empty_string>"}]'
```

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
The contract is deployed on Casper testnet and backend submission has been smoke-tested. The backend still does not automatically run `get-transaction`, verify execution success, or query the stored on-chain anchor record; do that manually before treating a pending anchor as final.
:::

## Verified Testnet Deployment

```text
deploy_transaction=3b8f624ef1d5960a8cf724811c0c68c51dff8809fa1128f69a2c7077afdcbc09
contract_hash=hash-9a10301e16f0871c57cf584810848d9eb859ba2c8c168fdf1cd7bdef99cb32df
package_hash=hash-162da01355500a4ec1e715cfab6e5f3f12ee8cc57b3d23c444f377ad4014c98c
backend_smoke_anchor_transaction=91fb904e47b600b0a9e4f6571a3412c83187000e9ceab19ba26cc23fabec555c
```

The smoke transaction executed with `error_message: null` and wrote both `anchor_<anchor_id>` and `agent_latest_<agent_hash>` keys.

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
  --pricing-mode classic \
  --payment-amount 100000000000 \
  --standard-payment true \
  --wasm-path contracts/memory-anchor/target/wasm32-unknown-unknown/release/sigil_memory_anchor.wasm \
  --session-entry-point call \
  --install-upgrade

casper-client get-transaction --node-address "$CASPER_RPC_URL" "<TRANSACTION_HASH>"
```

Do not copy contract/package hashes into backend env until the deploy transaction is retrieved and verified successful. After backend submissions, use `get-transaction` on the returned transaction hash to confirm execution before relying on the on-chain record.
