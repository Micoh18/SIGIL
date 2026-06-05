#![no_std]

// SIGIL memory_anchor Casper contract placeholder.
//
// This file intentionally avoids importing Casper crates until the project can
// be scaffolded with cargo-casper and verified with casper-client. The current
// backend anchor client accepts only hash-only payloads and does not claim a
// transaction hash until a real Casper submission path is implemented.
//
// Planned storage model:
// - anchors::<anchor_id_hex> -> AnchorRecord
// - agent_latest::<agent_id_hash_hex> -> anchor_id_hex
// - policy_commitments::<policy_id_hash_hex> -> PolicyCommitment
//
// Planned entry points:
// - anchor_memory(agent_id_hash, memory_id_hash, content_hash, metadata_hash, prev_anchor_hash)
// - anchor_policy(policy_id_hash, policy_hash)
// - set_admin(account_hash, enabled)

#[no_mangle]
pub extern "C" fn call() {
    // Stub. Replace with cargo-casper generated install/entrypoint wiring.
}
