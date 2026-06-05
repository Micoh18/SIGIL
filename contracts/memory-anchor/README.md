# Mr Mainspring memory-anchor contract

This directory holds the Casper Rust/Wasm contract source for `memory_anchor`.

Current state: **hash-only contract source, built and deployed on Casper testnet**. The local runner built the Wasm artifact with stable Rust and the `wasm32-unknown-unknown` target using repo Cargo flags that disable unsupported bulk-memory operations.

Verified testnet deployment:

```text
deploy_transaction=3b8f624ef1d5960a8cf724811c0c68c51dff8809fa1128f69a2c7077afdcbc09
contract_hash=hash-9a10301e16f0871c57cf584810848d9eb859ba2c8c168fdf1cd7bdef99cb32df
package_hash=hash-162da01355500a4ec1e715cfab6e5f3f12ee8cc57b3d23c444f377ad4014c98c
backend_smoke_anchor_transaction=91fb904e47b600b0a9e4f6571a3412c83187000e9ceab19ba26cc23fabec555c
```

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
CASPER_ENABLE_REAL_SUBMISSION="true"
CASPER_CLIENT_BIN="casper-client"
CASPER_GAS_PRICE_TOLERANCE="10"
CASPER_PRICING_MODE="classic"
CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES="3000000000"
```

Install and verify on testnet only after the build succeeds:

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

Only after `get-transaction` shows successful execution should the resulting contract and package hashes be copied into the backend environment.
