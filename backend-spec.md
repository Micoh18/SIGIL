# Backend Development Spec: SIGIL

Version: 0.1  
Scope: Backend only  
Source context: `contexto.md` at repository root

## 1. Project Summary

SIGIL is backend infrastructure for agentic applications on Casper. It gives any AI agent an MCP server with three core capabilities:

1. Verifiable agent memory: agents can write, read, search, and cryptographically anchor memory hashes on Casper testnet.
2. Grimoire vault: agents can use scoped secrets and spending policies without exposing raw secrets to prompts, logs, or public chain state.
3. x402 payments on Casper: agents can pay for HTTP micro-services through x402, record receipts, and anchor important payment/memory events.

The winning hackathon angle is infrastructure rather than a single-purpose agent. The demo should show an agent buying data via x402, saving the result as memory, anchoring the memory hash on Casper, and proving later that the memory was not modified.

## 2. Backend Goals

- Provide an MCP server that an agent can plug into immediately.
- Store full memory records off-chain and anchor only non-sensitive hashes on-chain.
- Support Casper testnet deployment of a Rust/Wasm smart contract.
- Integrate Casper x402 through the existing `make-software/casper-x402` facilitator.
- Enforce spending policy before every paid x402 request.
- Keep secret values encrypted at rest and redacted from logs.
- Produce a demo-friendly audit trail that links MCP tool calls, x402 payment receipts, and Casper transaction hashes.
- Keep the architecture simple enough to complete during a hackathon while leaving a credible path to production.

## 3. Non-Goals

- No frontend implementation in this spec.
- No mainnet launch in the first milestone.
- No storage of plaintext memory, secrets, or private keys on-chain.
- No custom x402 settlement implementation unless the existing Casper x402 facilitator blocks delivery.
- No generalized multi-chain payment support in the first version.

## 4. External Constraints And Facts

The referenced Casper docs and x402 repository imply these backend constraints:

- Casper contracts are Rust contracts compiled to WebAssembly.
- Casper development should use `cargo-casper`, `casper-client`, and Casper Rust crates.
- Casper contract testing can use `casper-engine-test-support` without running a full node.
- Casper clients interact with nodes through JSON-RPC endpoints.
- Official Casper docs warn that Windows is not advised for comfortable Casper development, so local contract work should use WSL Ubuntu, Linux, or macOS.
- `make-software/casper-x402` is a Go implementation of x402 for Casper. It exposes a facilitator HTTP server on port `4022`, a demo paid resource server on port `4021`, and a demo client.
- The Casper x402 flow uses HTTP `402 Payment Required`, `PaymentRequirements`, a signed payment payload, facilitator verification, and Casper settlement through CEP-18 `transfer_with_authorization`.
- The current `casper-x402` repository documents Go `1.25+`, a funded Casper account for the facilitator, a deployed CEP-18 x402 token contract, and a Casper JSON-RPC endpoint as requirements.

## 5. Proposed Backend Stack

### 5.1 Smart Contract

- Language: Rust
- Target: Wasm, Casper testnet
- Tooling: `cargo-casper`, `casper-client`, `casper-engine-test-support`
- Contract name: `memory_anchor`

### 5.2 MCP And API Backend

- Runtime: Node.js LTS
- Language: TypeScript
- Transport:
  - MCP stdio for local agent demo.
  - Optional Streamable HTTP MCP endpoint for remote demo.
- HTTP framework: Fastify or Hono.
- Database: SQLite for hackathon demo, Postgres-compatible schema for production.
- ORM/query builder: Prisma, Drizzle, or Kysely. Prefer Drizzle/Kysely if minimal migrations are desired.
- Hashing/canonicalization: deterministic JSON canonicalization plus SHA-256.
- Casper client access:
  - Prefer `casper-js-sdk` for query and transaction orchestration from the TypeScript backend.
  - Keep contract build/deploy scripts in Rust/Casper CLI tooling.

### 5.3 Payment Sidecar

- Use `make-software/casper-x402` as a sidecar service.
- Components:
  - Facilitator: verifies and settles Casper x402 payment payloads.
  - Demo paid resource server: used for the hackathon story.
  - Optional headless demo client: used only for reference tests.

## 6. High-Level Architecture

```text
AI Agent / Claude
      |
      | MCP tools
      v
SIGIL MCP Backend (TypeScript)
      |
      |-- Memory module
      |      |-- SQLite/Postgres memory store
      |      |-- Canonical hash builder
      |      |-- Casper anchor client
      |
      |-- Grimoire module
      |      |-- Encrypted secrets
      |      |-- Spending policies
      |      |-- Secret access audit
      |
      |-- x402 module
      |      |-- Policy preflight
      |      |-- Paid HTTP request handler
      |      |-- Receipt recorder
      |      |-- Casper x402 facilitator sidecar
      |
      |-- Audit module
             |-- MCP call log
             |-- Payment receipt log
             |-- Anchor verification log

Casper Testnet
      |
      |-- memory_anchor Rust/Wasm contract
      |-- CEP-18 x402 token contract
```

## 7. Backend Components

### 7.1 Memory Module

Responsibilities:

- Create immutable memory records for agent actions, observations, and payment outcomes.
- Store full records off-chain.
- Compute stable content hashes.
- Anchor selected memory hashes on Casper.
- Verify local records against on-chain anchors.
- Provide search/read tools to agents.

Memory classes:

- `observation`: data returned by a paid or free service.
- `decision`: agent rationale or selected action.
- `payment`: x402 payment intent, result, or receipt.
- `secret_usage`: metadata that a secret was used, never the secret value.
- `system_event`: deployment, policy change, verification event.

Canonical memory envelope:

```json
{
  "schema_version": "sigil.memory.v1",
  "agent_id": "agent-demo-1",
  "memory_id": "mem_01J...",
  "type": "observation",
  "source": {
    "kind": "x402_http",
    "url": "http://localhost:4021/weather",
    "payment_id": "pay_01J..."
  },
  "body": {
    "summary": "Weather response returned by paid service",
    "data": {}
  },
  "created_at": "2026-06-04T00:00:00.000Z",
  "prev_anchor_hash": "optional-hex-string"
}
```

Hashing rules:

- Use JSON canonicalization before hashing.
- Exclude mutable database fields such as row IDs, local timestamps, retry counters, and sync status.
- Use SHA-256 for cross-language simplicity.
- Store hash as lowercase hex.
- For anchored memory, compute:

```text
content_hash = sha256(canonical_memory_envelope)
anchor_id = sha256(agent_id + ":" + memory_id + ":" + content_hash + ":" + prev_anchor_hash)
```

### 7.2 Casper Memory Anchor Contract

Contract name: `memory_anchor`

Purpose:

- Store compact integrity proofs for agent memory and policy commitments.
- Keep sensitive content off-chain.
- Provide explorer-visible proof that a memory hash existed at a specific point in chain history.

Stored values:

```rust
struct AnchorRecord {
    agent_id_hash: [u8; 32],
    memory_id_hash: [u8; 32],
    content_hash: [u8; 32],
    metadata_hash: [u8; 32],
    prev_anchor_hash: Option<[u8; 32]>,
    writer: AccountHash,
    created_at_millis: u64
}
```

Dictionary keys:

```text
anchors::<anchor_id_hex> -> AnchorRecord
agent_latest::<agent_id_hash_hex> -> anchor_id_hex
policy_commitments::<policy_id_hash_hex> -> PolicyCommitment
```

Entry points:

- `anchor_memory(agent_id_hash, memory_id_hash, content_hash, metadata_hash, prev_anchor_hash)`
  - Stores a new memory anchor.
  - Rejects duplicate `anchor_id`.
  - Updates latest anchor for the agent.
- `anchor_policy(policy_id_hash, policy_hash)`
  - Stores or updates a policy commitment hash.
  - Used to prove that local policy state matches the committed policy state.
- `set_admin(account_hash, enabled)`
  - Optional for demo. Allows project owner to authorize backend signer rotation.

Authorization:

- Initial version allows only contract owner/admin accounts to write anchors.
- Read access is public through Casper state queries.
- Production path can add per-agent writer allowlists.

Contract acceptance criteria:

- Builds to Wasm with `make build-contract` or equivalent `cargo-casper` workflow.
- Unit/integration tests install the contract, write memory anchors, reject duplicates, update latest anchor, and query stored records.
- Testnet deployment script outputs contract package hash, contract hash, and deploy/transaction hash.

### 7.3 Grimoire Vault Module

Responsibilities:

- Store secrets encrypted at rest.
- Store policies controlling how secrets and payment authority may be used.
- Return secret-derived capabilities to backend code, not raw secret values to the model.
- Record every access attempt.

Secret types:

- `casper_private_key_ref`: path, encrypted PEM, or KMS reference for signing Casper transactions.
- `x402_client_key_ref`: key used by the agent/client to sign x402 payment payloads.
- `api_key`: paid data provider credentials if needed.
- `webhook_secret`: optional for remote services.

Encryption:

- Use envelope encryption.
- Minimum hackathon version:
  - `GRIMOIRE_MASTER_KEY` is a 32-byte base64 key provided through environment variables.
  - Secret values encrypted with AES-256-GCM.
  - Store nonce, ciphertext, and auth tag.
- Production path:
  - Replace local master key with KMS, HSM, or cloud secret manager.

Policy model:

```json
{
  "policy_id": "pol_demo_weather",
  "agent_id": "agent-demo-1",
  "enabled": true,
  "allowed_urls": ["http://localhost:4021/weather"],
  "allowed_methods": ["GET"],
  "max_amount_per_call": "0.05",
  "max_amount_per_period": "1.00",
  "period_seconds": 86400,
  "allowed_asset": {
    "caip2_chain_id": "casper:casper-test",
    "asset_package": "hex-package-hash"
  },
  "secret_scopes": ["x402:sign"],
  "created_at": "2026-06-04T00:00:00.000Z"
}
```

Policy enforcement:

- Enforce policy before a paid request is made.
- Deny by default when no policy matches.
- Track cumulative period spend in the database.
- Require exact URL/method allowlist match for the demo.
- Redact policy secrets from logs.
- Optionally anchor a policy commitment hash via `anchor_policy`.

### 7.4 x402 Payment Module

Responsibilities:

- Execute paid HTTP requests on behalf of an agent.
- Understand the x402 challenge/response flow.
- Use Casper x402 facilitator for verification/settlement.
- Record payment intent, requirements, signed payload metadata, settlement result, and response hash.
- Write payment memories automatically.

Payment flow:

1. Agent calls MCP tool `payment.fetch`.
2. Backend checks policy for `agent_id`, URL, method, amount, and asset.
3. Backend sends initial HTTP request to target resource.
4. If the target returns `402 Payment Required`, backend parses `PaymentRequirements`.
5. Backend validates the requested network, asset, price, and payee against policy.
6. Backend asks Grimoire for a signing capability.
7. Backend creates/signs the Casper x402 payment payload using the x402 client mechanism.
8. Backend replays the HTTP request with the required payment header.
9. Resource server/facilitator verifies and settles payment.
10. Backend stores payment receipt and response hash.
11. Backend writes a `payment` memory and an `observation` memory.
12. Backend anchors selected memory hashes on Casper.

Payment states:

- `created`
- `policy_checked`
- `requirements_received`
- `signed`
- `submitted`
- `settled`
- `failed`
- `refunded_or_disputed` if later supported

Receipt record:

```json
{
  "payment_id": "pay_01J...",
  "agent_id": "agent-demo-1",
  "url": "http://localhost:4021/weather",
  "method": "GET",
  "amount": "0.01",
  "asset_package": "hex-package-hash",
  "caip2_chain_id": "casper:casper-test",
  "facilitator_url": "http://localhost:4022",
  "casper_transaction_hash": "hex",
  "response_hash": "sha256-hex",
  "status": "settled"
}
```

### 7.5 MCP Server

The MCP server is the primary backend interface for agents.

Transports:

- `stdio`: required for the local demo.
- `http`: optional for remote demos and browser-based tooling.

Tools:

#### `memory.write`

Input:

```json
{
  "agent_id": "agent-demo-1",
  "type": "observation",
  "source": {},
  "body": {},
  "anchor": true
}
```

Output:

```json
{
  "memory_id": "mem_01J...",
  "content_hash": "sha256-hex",
  "anchor": {
    "status": "anchored",
    "anchor_id": "sha256-hex",
    "casper_transaction_hash": "hex"
  }
}
```

#### `memory.read`

Input:

```json
{
  "agent_id": "agent-demo-1",
  "memory_id": "mem_01J..."
}
```

Output: full memory envelope plus anchor status.

#### `memory.search`

Input:

```json
{
  "agent_id": "agent-demo-1",
  "query": "weather purchase",
  "limit": 10
}
```

Output: ranked memory summaries and IDs.

Search implementation:

- Hackathon: SQLite FTS5 or simple full-text index.
- Production: vector embeddings plus keyword search.

#### `memory.verify`

Input:

```json
{
  "agent_id": "agent-demo-1",
  "memory_id": "mem_01J..."
}
```

Output:

```json
{
  "valid": true,
  "local_content_hash": "sha256-hex",
  "onchain_content_hash": "sha256-hex",
  "anchor_id": "sha256-hex",
  "casper_transaction_hash": "hex"
}
```

#### `payment.fetch`

Input:

```json
{
  "agent_id": "agent-demo-1",
  "method": "GET",
  "url": "http://localhost:4021/weather",
  "policy_id": "pol_demo_weather",
  "anchor_result": true
}
```

Output:

```json
{
  "payment_id": "pay_01J...",
  "status": "settled",
  "amount": "0.01",
  "casper_transaction_hash": "hex",
  "response": {},
  "memories": ["mem_01J...", "mem_01K..."]
}
```

#### `payment.receipt`

Input:

```json
{
  "payment_id": "pay_01J..."
}
```

Output: persisted payment receipt, redacted signed payload, and linked memory IDs.

#### `grimoire.secret.put`

Input:

```json
{
  "agent_id": "agent-demo-1",
  "name": "demo_x402_key",
  "type": "x402_client_key_ref",
  "value": "secret-value",
  "scopes": ["x402:sign"]
}
```

Output:

```json
{
  "secret_id": "sec_01J...",
  "status": "stored"
}
```

#### `grimoire.secret.list`

Returns secret metadata only. Never returns secret values.

#### `grimoire.policy.set`

Creates or updates a spending/access policy.

#### `grimoire.policy.get`

Returns policy metadata, current period usage, and optional on-chain commitment status.

#### `audit.tail`

Returns recent audit events for demo display or debugging.

### 7.6 Internal HTTP API

The HTTP API is for local scripts, tests, and optional frontend integration. MCP remains the main agent interface.

Endpoints:

```text
GET  /health
GET  /ready

POST /api/memory
GET  /api/memory/:memory_id
GET  /api/memory
POST /api/memory/:memory_id/anchor
GET  /api/memory/:memory_id/verify

POST /api/payments/fetch
GET  /api/payments/:payment_id

POST /api/grimoire/secrets
GET  /api/grimoire/secrets
DELETE /api/grimoire/secrets/:secret_id

POST /api/grimoire/policies
GET  /api/grimoire/policies/:policy_id

GET  /api/audit
```

HTTP auth:

- Hackathon local version may bind to localhost only.
- If exposed remotely, require bearer token auth and per-agent authorization.

## 8. Database Schema

### `agents`

```text
id text primary key
display_name text not null
status text not null
created_at datetime not null
updated_at datetime not null
```

### `memory_entries`

```text
id text primary key
agent_id text not null references agents(id)
type text not null
source_json text not null
body_json text not null
canonical_json text not null
content_hash text not null unique
metadata_hash text not null
prev_anchor_hash text null
anchor_status text not null
created_at datetime not null
updated_at datetime not null
```

### `memory_anchors`

```text
id text primary key
memory_id text not null references memory_entries(id)
agent_id text not null references agents(id)
anchor_id text not null unique
contract_hash text not null
contract_package_hash text null
casper_transaction_hash text not null
onchain_content_hash text not null
onchain_metadata_hash text not null
status text not null
created_at datetime not null
confirmed_at datetime null
```

### `secrets`

```text
id text primary key
agent_id text not null references agents(id)
name text not null
type text not null
scopes_json text not null
ciphertext text not null
nonce text not null
auth_tag text not null
key_version text not null
created_at datetime not null
updated_at datetime not null
deleted_at datetime null
unique(agent_id, name)
```

### `spending_policies`

```text
id text primary key
agent_id text not null references agents(id)
enabled boolean not null
allowed_urls_json text not null
allowed_methods_json text not null
allowed_asset_json text not null
max_amount_per_call text not null
max_amount_per_period text not null
period_seconds integer not null
secret_scopes_json text not null
policy_hash text not null
onchain_commitment_hash text null
created_at datetime not null
updated_at datetime not null
```

### `payment_intents`

```text
id text primary key
agent_id text not null references agents(id)
policy_id text not null references spending_policies(id)
method text not null
url text not null
amount text null
asset_package text null
caip2_chain_id text null
status text not null
requirements_json text null
signed_payload_hash text null
created_at datetime not null
updated_at datetime not null
```

### `payment_receipts`

```text
id text primary key
payment_id text not null references payment_intents(id)
facilitator_url text not null
casper_transaction_hash text null
settlement_status text not null
response_hash text null
response_status integer null
receipt_json text not null
created_at datetime not null
```

### `audit_events`

```text
id text primary key
agent_id text null
event_type text not null
subject_type text not null
subject_id text null
severity text not null
metadata_json text not null
created_at datetime not null
```

## 9. Environment Variables

```text
NODE_ENV=development
PORT=8787
DATABASE_URL=file:./data/sigil.db

MCP_TRANSPORT=stdio
HTTP_AUTH_TOKEN=dev-token

CASPER_NETWORK_NAME=casper-test
CASPER_CAIP2_CHAIN_ID=casper:casper-test
CASPER_RPC_URL=https://...
CASPER_ACCOUNT_KEY_PATH=./keys/backend.pem
CASPER_ACCOUNT_KEY_ALGO=ed25519
MEMORY_ANCHOR_CONTRACT_HASH=...
MEMORY_ANCHOR_PACKAGE_HASH=...

X402_FACILITATOR_URL=http://localhost:4022
X402_RESOURCE_DEMO_URL=http://localhost:4021/weather
X402_ASSET_PACKAGE=...
X402_ASSET_NAME=...

GRIMOIRE_MASTER_KEY=base64-32-byte-key
LOG_LEVEL=info
```

## 10. Development Milestones

### Milestone 0: Repository Bootstrap

Tasks:

- Create monorepo layout.
- Add TypeScript backend package.
- Add Rust Casper contract package.
- Add `docker-compose.yml` for backend, database, and x402 sidecars if possible.
- Add `.env.example`.
- Add README with local setup.

Acceptance criteria:

- `npm test` or equivalent runs backend unit tests.
- Contract package builds locally.
- Backend health endpoint works.

### Milestone 1: Memory Anchor Contract

Tasks:

- Scaffold `contracts/memory-anchor` with `cargo-casper`.
- Implement `anchor_memory`.
- Implement policy commitment anchor if time allows.
- Add contract tests using Casper engine test support.
- Add testnet deploy script.

Acceptance criteria:

- Contract rejects duplicate anchors.
- Contract stores and exposes anchor records through Casper state query.
- Testnet deployment hash is recorded in `.env.testnet.example` or docs.

### Milestone 2: MCP Memory Tools

Tasks:

- Implement memory canonicalization and SHA-256 hashing.
- Implement SQLite schema and migrations.
- Implement `memory.write`, `memory.read`, `memory.search`, `memory.verify`.
- Wire Casper query/write client for anchors.

Acceptance criteria:

- Agent can write memory locally.
- Agent can anchor memory on Casper testnet.
- Agent can verify memory against on-chain hash.

### Milestone 3: Grimoire Vault And Policies

Tasks:

- Implement encrypted secret storage.
- Implement policy CRUD.
- Implement policy matcher and spend tracking.
- Add redacted audit events.
- Add optional `anchor_policy`.

Acceptance criteria:

- Secret values are encrypted in the database.
- MCP tools never return raw secret values.
- Payment attempt without policy is denied.
- Payment attempt over limit is denied.

### Milestone 4: x402 Payment Integration

Tasks:

- Clone or vendor instructions for `make-software/casper-x402`.
- Run facilitator sidecar.
- Run demo resource server.
- Implement `payment.fetch`.
- Store payment intents and receipts.
- Auto-write payment and observation memories.

Acceptance criteria:

- Agent can request paid demo data through MCP.
- Backend records x402 settlement status and Casper transaction hash.
- Payment result memory can be anchored and verified.

### Milestone 5: Demo Agent And Audit Story

Tasks:

- Add demo script that connects to MCP server.
- Agent asks for paid data.
- Backend enforces policy, pays, stores response, anchors memory.
- Audit endpoint shows the complete story.

Acceptance criteria:

- Demo can be run from a clean local setup.
- Final output includes payment ID, memory IDs, anchor ID, and Casper transaction hash.
- The same memory verifies successfully after restart.

### Milestone 6: Hardening

Tasks:

- Add idempotency keys for paid requests and anchors.
- Add retries and timeout policies.
- Add structured logging and metrics.
- Add CI for TypeScript tests and Rust contract tests.
- Add threat model notes.

Acceptance criteria:

- Repeated `payment.fetch` with the same idempotency key does not double pay.
- Failed settlements produce clear audit events.
- CI catches backend and contract regressions.

## 11. Testing Strategy

### Contract Tests

- Install contract in in-memory Casper test builder.
- Write valid anchor.
- Reject duplicate anchor.
- Reject unauthorized writer if admin mode is enabled.
- Query anchor dictionary value.
- Verify latest anchor pointer.
- Anchor policy commitment.

### Backend Unit Tests

- Canonical JSON produces stable hash regardless of object key order.
- Memory hash excludes mutable local fields.
- Secret encryption/decryption works.
- Secret values are redacted from logs and MCP responses.
- Policy matcher allows valid request.
- Policy matcher rejects wrong URL, method, asset, and amount.
- Spend tracking rejects over-period attempts.

### Backend Integration Tests

- `memory.write` creates database row and audit event.
- `memory.write` with `anchor=true` calls Casper client abstraction.
- `memory.verify` compares local hash to mocked Casper state.
- `payment.fetch` handles initial 402 challenge.
- `payment.fetch` stores receipt and linked memories.
- Failed payment stores failure state without writing false settlement receipts.

### End-To-End Demo Test

- Start backend.
- Start x402 facilitator.
- Start paid resource server.
- Seed demo agent, secret, and policy.
- Call `payment.fetch` through MCP.
- Confirm paid response.
- Confirm payment receipt.
- Confirm memory rows.
- Confirm anchor transaction hash.
- Confirm `memory.verify` returns `valid=true`.

## 12. Security Requirements

- Never write secret values to logs, audit events, MCP responses, memory bodies, or on-chain records.
- Keep all on-chain records hash-only.
- Deny paid requests unless a matching enabled policy exists.
- Validate x402 `PaymentRequirements` against policy before signing.
- Validate amount, asset package, CAIP-2 chain ID, payee, URL, and method.
- Use idempotency keys to avoid double payment on retries.
- Store only signed payload hash unless the full payload is needed for debugging.
- Redact private keys and payment authorization material.
- Bind local demo HTTP services to localhost by default.
- Add request IDs to every audit event.

## 13. Observability

Structured log fields:

```text
request_id
agent_id
tool_name
memory_id
payment_id
policy_id
anchor_id
casper_transaction_hash
status
duration_ms
```

Metrics:

- MCP tool calls by tool and status.
- Memory writes and verification outcomes.
- Anchor submissions and confirmations.
- Payment attempts, settlements, failures, and denied policy checks.
- Secret access attempts by scope.

Audit event examples:

- `memory.created`
- `memory.anchor_submitted`
- `memory.anchor_confirmed`
- `memory.verify_succeeded`
- `payment.policy_approved`
- `payment.policy_denied`
- `payment.requirements_received`
- `payment.settled`
- `secret.access_granted`
- `secret.access_denied`

## 14. Deployment Plan

### Local Development

Recommended environment:

- WSL Ubuntu or Linux for Casper contract work.
- Node.js LTS for backend.
- Go `1.25+` for `casper-x402`.
- Rust toolchain plus `cargo-casper`.
- Casper CLI client.

Local commands to define later:

```text
npm run dev
npm run test
npm run db:migrate
npm run mcp:stdio
make -C contracts/memory-anchor test
make -C contracts/memory-anchor build-contract
```

### Testnet

Steps:

1. Generate Casper key pair.
2. Fund testnet account through faucet.
3. Deploy CEP-18 x402 token if not using sponsor-provided asset.
4. Deploy `memory_anchor` contract.
5. Configure backend with contract hashes and RPC URL.
6. Configure x402 facilitator with funded account, RPC URL, and asset package.
7. Run demo flow.
8. Capture explorer links for payment settlement and memory anchor transactions.

## 15. Recommended Repository Layout

```text
.
|-- contexto.md
|-- backend-spec.md
|-- README.md
|-- .env.example
|-- docker-compose.yml
|-- backend/
|   |-- package.json
|   |-- tsconfig.json
|   |-- src/
|   |   |-- index.ts
|   |   |-- config.ts
|   |   |-- mcp/
|   |   |-- http/
|   |   |-- memory/
|   |   |-- grimoire/
|   |   |-- payments/
|   |   |-- casper/
|   |   |-- audit/
|   |   `-- db/
|   `-- tests/
|-- contracts/
|   `-- memory-anchor/
|       |-- contract/
|       |-- tests/
|       |-- Makefile
|       `-- rust-toolchain.toml
|-- scripts/
|   |-- deploy-memory-anchor.ps1
|   |-- deploy-memory-anchor.sh
|   `-- seed-demo-agent.ts
`-- docs/
    |-- demo-runbook.md
    |-- threat-model.md
    `-- api.md
```

## 16. Open Technical Decisions

1. Exact MCP SDK and transport package version.
2. Whether to use SQLite only or start with Postgres from day one.
3. Whether the backend should call Casper through `casper-js-sdk` or shell out to `casper-client` for the first demo.
4. Exact Casper testnet CAIP-2 identifier and token package hash used by sponsor/facilitator.
5. Whether x402 client signing should be implemented directly in TypeScript or delegated to the Go demo client/library through a small local helper.
6. Whether policy commitments are needed in the first demo or can wait until after memory anchoring works.

Recommended answers for the first build:

- Use SQLite for speed, but design schema to migrate to Postgres.
- Use TypeScript for MCP/backend.
- Use the Go Casper x402 facilitator as-is.
- Use Casper CLI for first contract deploy scripts.
- Implement memory anchoring before policy anchoring.

## 17. Demo Acceptance Script

The final backend demo should prove this sequence:

1. Start SIGIL MCP backend.
2. Start Casper x402 facilitator.
3. Start paid demo resource server.
4. Seed agent, encrypted x402 signing secret, and spending policy.
5. Agent calls `payment.fetch` for paid weather data.
6. Backend receives 402 challenge and validates requirements against policy.
7. Backend signs and completes x402 payment.
8. Facilitator settles on Casper.
9. Backend records payment receipt.
10. Backend writes payment and observation memories.
11. Backend anchors memory hash on Casper.
12. Agent calls `memory.verify`.
13. Backend returns `valid=true` with local hash, on-chain hash, anchor ID, and Casper transaction hash.

## 18. Main Risks

### x402 Casper maturity

Risk: The Casper x402 implementation is new and has no releases published.  
Mitigation: Pin to a commit, use the documented demo resource server first, and isolate payment integration behind a small backend interface.

### Development environment friction

Risk: Casper docs advise against Windows for comfortable development.  
Mitigation: Use WSL Ubuntu for Rust/Wasm contract tooling and keep Node backend runnable on Windows.

### Contract complexity

Risk: Overbuilding the contract can consume hackathon time.  
Mitigation: Store hash records only. Keep privacy, search, and policy evaluation off-chain.

### Double payments

Risk: Retries can accidentally pay twice.  
Mitigation: Add idempotency keys and persist payment state before replaying a paid request.

### Secret exposure

Risk: Agent tools can leak secrets if raw values are returned.  
Mitigation: MCP tools expose secret metadata and scoped signing capabilities only.

## 19. References

- Root project context: `contexto.md`
- Casper docs: https://docs.casper.network/
- Casper development prerequisites: https://docs.casper.network/developers/prerequisites
- Casper Rust contracts getting started: https://docs.casper.network/developers/writing-onchain-code/getting-started
- Casper basic smart contract guide: https://docs.casper.network/developers/writing-onchain-code/simple-contract
- Casper contract testing guide: https://docs.casper.network/developers/writing-onchain-code/testing-contracts
- Casper sending transactions guide: https://docs.casper.network/developers/cli/sending-transactions
- Casper x402 facilitator repository: https://github.com/make-software/casper-x402
