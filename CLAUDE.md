# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

Public name: **Mr Mainspring**. Internal identifiers (`sigil`, `SIGIL`, `sigil_`) are stable technical names — keep them in env vars, paths, and table prefixes.

## Commands

All backend work runs from `backend/`:

```bash
cd backend
npm install
npm test               # run full test suite (vitest)
npm run build          # tsc → dist/
npm run dev            # tsx src/index.ts (live TS dev)
npm run mcp:stdio      # node dist/index.js (production stdio MCP)
npm run demo:stdio     # build + run demo script
```

Run a single test file:
```bash
cd backend
npx vitest run tests/memory.test.ts
```

Docs site (from repo root):
```bash
npm install --prefix docs-site
npm run build --prefix docs-site
npm run preview --prefix docs-site   # http://127.0.0.1:4173/
```

Casper contract (requires `wasm32-unknown-unknown` target and `casper-client`):
```bash
cd contracts/memory-anchor
cargo build --release --target wasm32-unknown-unknown
```

## Architecture

**Transport**: stdio only. No HTTP server. Entry point: `backend/src/index.ts` → `loadLocalEnvFile()` → `loadConfig()` → `createSigilServer()` → `StdioServerTransport`.

**Dependency graph** inside `backend/src/`:

```
index.ts
  └── server.ts                  wires services + registers tools
        ├── storage/store-factory.ts  → file or supabase stores
        ├── audit/service.ts
        ├── casper/anchorClient.ts
        ├── memory/service.ts         (store + audit + anchorClient)
        ├── grimoire/service.ts       (store + masterKey + audit)
        ├── payments/service.ts       (grimoire + store + audit + x402Client + settlementProvider)
        └── mcp/{memory,grimoire,payment,audit}Tools.ts
```

**Storage abstraction**: every domain (`memory`, `grimoire`, `payments`, `audit`) has a `File*Store` and a `Supabase*Store` behind the same interface. `createBackendStores()` selects one based on `SIGIL_STORAGE_BACKEND`. File stores write JSONB under `SIGIL_DATA_DIR` (default `.sigil/`). Supabase stores use PostgREST via `SupabaseRestClient` — apply `backend/supabase/schema.sql` first.

**Memory hashing**: SHA-256 over deterministic JSON canonicalization (`memory/canonical.ts`). `content_hash` covers the full envelope; `metadata_hash` covers agent/memory IDs + timestamps only. Both must be preserved for on-chain anchoring.

**Casper anchoring**: two modes toggled by config — `unconfigured` (local pending metadata only) and `configured` (shells out to `casper-client put-transaction`). `CASPER_ENABLE_REAL_SUBMISSION=true` required to actually submit. Submission mode: `transaction-package` (default) or `deploy-contract-hash`.

**x402 payments**: three-stage lifecycle — `policy_checked` → `challenge_received` → `settlement_unavailable` (real settlement not implemented). `DisabledX402SettlementProvider` is the only settlement provider; it always returns a blocker reason.

**Grimoire**: AES-GCM encryption via `GRIMOIRE_MASTER_KEY`. If the key is absent, a deterministic dev key is derived. Plaintext is **never** returned from any MCP tool.

## Key Invariants

- `casper-client` is invoked via `spawn()` — never trust unvalidated hash strings as CLI args. All hash inputs are validated against `/^(hash-)?[a-f0-9]{64}$/i` before use.
- On-chain: hashes only. No memory bodies, secrets, signed payloads, or private keys go to the contract.
- Settlement, on-chain query, and HTTP paid-retry paths are **not implemented**. Return honest pre-settlement states; do not fake verified receipts or signed payloads.
- `CASPER_ENABLE_REAL_SUBMISSION` and `X402_ENABLE_REAL_SETTLEMENT` are explicit opt-in gates — never default them to true.

## Environment

Copy `.env.example` to `.env` (checked first by `loadLocalEnvFile()`). Critical vars:

| Var | Purpose |
|-----|---------|
| `SIGIL_DATA_DIR` | file store root (default `.sigil/`) |
| `SIGIL_STORAGE_BACKEND` | `file` (default) or `supabase` |
| `PROJECT_URL` / `SECRET_KEY` | Supabase project URL + service role key |
| `GRIMOIRE_MASTER_KEY` | base64 32-byte AES-GCM key |
| `CASPER_ENABLE_REAL_SUBMISSION` | opt-in gate for casper-client calls |
| `MEMORY_ANCHOR_CONTRACT_HASH` / `MEMORY_ANCHOR_PACKAGE_HASH` | deployed testnet contract |
| `X402_ENABLE_REAL_SETTLEMENT` | opt-in gate for real x402 settlement |

Deployed testnet contract hashes are in `README.md` under "Casper Contract Status".
