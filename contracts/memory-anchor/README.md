# Mr Mainspring memory-anchor contract

This directory holds the Casper Rust/Wasm contract source for `memory_anchor`.

Current state: **hash-only contract source, locally built, not deployed**. The local runner built the Wasm artifact with stable Rust and the `wasm32-unknown-unknown` target. Real testnet deployment is still blocked until `casper-client` is installed and a funded Casper testnet account is available.

Entry points:

- `anchor_memory(anchor_id, agent_id_hash, memory_id_hash, content_hash, metadata_hash, prev_anchor_hash)`

Storage:

- `anchor_<anchor_id>` stores `agent_id_hash:memory_id_hash:content_hash:metadata_hash:prev_anchor_hash`.
- `agent_latest_<agent_id_hash>` stores the latest `anchor_id`.

Security boundary:

- On-chain records are hash-only.
- Memory bodies, secrets, payment payloads, signed payment payloads, and private keys stay off-chain.
- `prev_anchor_hash` is an empty string when there is no previous anchor.
- All anchor arguments must be lowercase 64-character hex strings except empty `prev_anchor_hash`.

Manual prerequisites:

```bash
rustup target add wasm32-unknown-unknown
cargo install cargo-casper
cargo install casper-client
```

Direct build command:

```bash
cd contracts/memory-anchor
cargo build --release --target wasm32-unknown-unknown
```

Optional Makefile commands, if `make` is installed:

```bash
make -C contracts/memory-anchor prepare
make -C contracts/memory-anchor build-contract
make -C contracts/memory-anchor test
```

Expected Wasm path after a successful build:

```text
contracts/memory-anchor/target/wasm32-unknown-unknown/release/sigil_memory_anchor.wasm
```

Required real testnet environment:

```bash
CASPER_RPC_URL="https://<testnet-node>:7777/rpc"
CASPER_NETWORK_NAME="casper-test"
MEMORY_ANCHOR_CONTRACT_HASH="hash-<64 hex chars>"
MEMORY_ANCHOR_PACKAGE_HASH="hash-<64 hex chars>"
CASPER_ACCOUNT_KEY_PATH="./keys/backend.pem"
```

Install and verify on testnet only after the build succeeds:

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

Only after `get-transaction` shows successful execution should the resulting contract and package hashes be copied into the backend environment.
