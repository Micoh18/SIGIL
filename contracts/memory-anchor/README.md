# SIGIL memory-anchor contract stub

This directory holds the planned Casper Rust/Wasm contract for `memory_anchor`.

Current state: **source/spec stub only**. The local runner does not currently have Rust, `cargo`, `cargo-casper`, or `casper-client` available, so this overnight backend pass did not claim a contract build or testnet deploy.

Planned entry points:

- `anchor_memory(agent_id_hash, memory_id_hash, content_hash, metadata_hash, prev_anchor_hash)`
- `anchor_policy(policy_id_hash, policy_hash)`
- `set_admin(account_hash, enabled)`

Security boundary:

- On-chain records are hash-only.
- Memory bodies, secrets, payment payloads, and private keys stay off-chain.
- Initial writer authorization should be owner/admin-only.

To replace this stub with a buildable Casper contract:

```bash
cargo install cargo-casper
cargo casper memory-anchor
make -C contracts/memory-anchor build-contract
make -C contracts/memory-anchor test
```
