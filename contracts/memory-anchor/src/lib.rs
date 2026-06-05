#![no_std]
#![no_main]

extern crate alloc;

use core::panic::PanicInfo;

use alloc::{
    format,
    string::{String, ToString},
    vec,
};
use casper_contract::{
    contract_api::{runtime, storage},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    api_error::ApiError, CLType, EntityEntryPoint, EntryPointAccess, EntryPointPayment,
    EntryPointType, EntryPoints, NamedKeys, Parameter,
};

const CONTRACT_HASH_KEY: &str = "sigil_memory_anchor";
const CONTRACT_PACKAGE_NAME: &str = "sigil_memory_anchor_package";
const CONTRACT_ACCESS_UREF: &str = "sigil_memory_anchor_access";
const CONTRACT_VERSION_KEY: &str = "sigil_memory_anchor_version";

const ENTRY_POINT_ANCHOR_MEMORY: &str = "anchor_memory";

const ARG_ANCHOR_ID: &str = "anchor_id";
const ARG_AGENT_ID_HASH: &str = "agent_id_hash";
const ARG_MEMORY_ID_HASH: &str = "memory_id_hash";
const ARG_CONTENT_HASH: &str = "content_hash";
const ARG_METADATA_HASH: &str = "metadata_hash";
const ARG_PREV_ANCHOR_HASH: &str = "prev_anchor_hash";

const HASH_LEN: usize = 64;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[repr(u16)]
#[derive(Clone, Copy)]
enum MemoryAnchorError {
    InvalidAnchorId = 1,
    InvalidAgentIdHash = 2,
    InvalidMemoryIdHash = 3,
    InvalidContentHash = 4,
    InvalidMetadataHash = 5,
    InvalidPrevAnchorHash = 6,
    DuplicateAnchor = 7,
    InvalidNamedKey = 8,
}

impl From<MemoryAnchorError> for ApiError {
    fn from(error: MemoryAnchorError) -> Self {
        ApiError::User(error as u16)
    }
}

#[no_mangle]
pub extern "C" fn anchor_memory() {
    let anchor_id: String = runtime::get_named_arg(ARG_ANCHOR_ID);
    let agent_id_hash: String = runtime::get_named_arg(ARG_AGENT_ID_HASH);
    let memory_id_hash: String = runtime::get_named_arg(ARG_MEMORY_ID_HASH);
    let content_hash: String = runtime::get_named_arg(ARG_CONTENT_HASH);
    let metadata_hash: String = runtime::get_named_arg(ARG_METADATA_HASH);
    let prev_anchor_hash: String = runtime::get_named_arg(ARG_PREV_ANCHOR_HASH);

    assert_hash(&anchor_id, MemoryAnchorError::InvalidAnchorId);
    assert_hash(&agent_id_hash, MemoryAnchorError::InvalidAgentIdHash);
    assert_hash(&memory_id_hash, MemoryAnchorError::InvalidMemoryIdHash);
    assert_hash(&content_hash, MemoryAnchorError::InvalidContentHash);
    assert_hash(&metadata_hash, MemoryAnchorError::InvalidMetadataHash);
    if !prev_anchor_hash.is_empty() {
        assert_hash(&prev_anchor_hash, MemoryAnchorError::InvalidPrevAnchorHash);
    }

    let anchor_key = anchor_record_key(&anchor_id);
    if runtime::has_key(&anchor_key) {
        runtime::revert(MemoryAnchorError::DuplicateAnchor);
    }

    let record = format!(
        "{}:{}:{}:{}:{}",
        agent_id_hash, memory_id_hash, content_hash, metadata_hash, prev_anchor_hash
    );
    runtime::put_key(&anchor_key, storage::new_uref(record).into());

    upsert_string(&latest_anchor_key(&agent_id_hash), anchor_id);
}

#[no_mangle]
pub extern "C" fn call() {
    let mut entry_points = EntryPoints::new();
    entry_points.add_entry_point(EntityEntryPoint::new(
        ENTRY_POINT_ANCHOR_MEMORY,
        vec![
            Parameter::new(ARG_ANCHOR_ID, CLType::String),
            Parameter::new(ARG_AGENT_ID_HASH, CLType::String),
            Parameter::new(ARG_MEMORY_ID_HASH, CLType::String),
            Parameter::new(ARG_CONTENT_HASH, CLType::String),
            Parameter::new(ARG_METADATA_HASH, CLType::String),
            Parameter::new(ARG_PREV_ANCHOR_HASH, CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    let named_keys = NamedKeys::new();
    let (contract_hash, contract_version) = storage::new_contract(
        entry_points,
        Some(named_keys),
        Some(CONTRACT_PACKAGE_NAME.to_string()),
        Some(CONTRACT_ACCESS_UREF.to_string()),
        None,
    );

    runtime::put_key(CONTRACT_HASH_KEY, contract_hash.into());
    runtime::put_key(
        CONTRACT_VERSION_KEY,
        storage::new_uref(contract_version).into(),
    );
}

fn upsert_string(key_name: &str, value: String) {
    match runtime::get_key(key_name) {
        Some(key) => {
            let uref = key
                .into_uref()
                .unwrap_or_revert_with(MemoryAnchorError::InvalidNamedKey);
            storage::write(uref, value);
        }
        None => runtime::put_key(key_name, storage::new_uref(value).into()),
    }
}

fn anchor_record_key(anchor_id: &str) -> String {
    format!("anchor_{}", anchor_id)
}

fn latest_anchor_key(agent_id_hash: &str) -> String {
    format!("agent_latest_{}", agent_id_hash)
}

fn assert_hash(value: &str, error: MemoryAnchorError) {
    if value.len() != HASH_LEN || !value.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        runtime::revert(error);
    }

    if value.as_bytes().iter().any(u8::is_ascii_uppercase) {
        runtime::revert(error);
    }
}
