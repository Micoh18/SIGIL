# Mr Mainspring

Mr Mainspring is an MCP server and Casper testnet demo stack for agents that need a durable witness: memory that can be verified, secrets that stay hidden, policy-gated x402 payments, auditable receipts, and optional hash-only on-chain anchoring.

It is built for the point where an autonomous agent stops being a chat session and starts making decisions that money, users, or infrastructure depend on.

## What It Does

Mr Mainspring turns an agent action into a record that can be checked later:

1. The agent gets a stable local identity.
2. The agent writes memory as canonical JSON and receives deterministic SHA-256 hashes.
3. Secrets and signer references live in Grimoire, encrypted with AES-256-GCM and returned only as metadata.
4. Spending and access policies are committed with policy hashes before any payment intent can proceed.
5. `payment.fetch` can preflight a policy, capture a real HTTP 402 x402 challenge, approve payment requirements against policy, settle through a configured Casper path, and persist only safe receipt metadata.
6. Audit events record memory, policy, payment, and anchor activity.
7. Optional Casper anchoring submits hashes only. Memory bodies, secrets, private keys, and signed payment payloads are never written on-chain.

## Current Build

- Installable npm package: `mrmainspring`
- Package version in code: `0.3.6`
- Runtime: Node.js 20+
- MCP transport: stdio
- Storage: local JSON files by default, optional Supabase PostgREST tables
- Chain target: Casper testnet
- x402 demo asset: native CSPR, represented as integer motes
- Public site build: static frontend copied to `dist/`, with optional VitePress docs under `/docs`
- Public demo backend: Render Docker Blueprint running the x402 demo API

Some internal package names, schema names, environment variables, and table prefixes still use `sigil` or `SIGIL`. Treat those as stable technical identifiers, not the public product name.

## Quick Start

No global install is required:

```bash
npx -y mrmainspring setup
```

`setup` creates local config, data, logs, a stable `agent_id`, and a `GRIMOIRE_MASTER_KEY` in the user's standard app config folder. It also auto-configures detected MCP clients when possible:

- Claude Desktop
- Claude Code
- Cursor
- Windsurf
- Zed
- Continue
- VS Code

If no client can be configured automatically, add this MCP server config manually:

```json
{
  "mcpServers": {
    "mainspring": {
      "command": "npx",
      "args": ["-y", "mrmainspring"]
    }
  }
}
```

Check the local setup:

```bash
npx -y mrmainspring doctor
```

Start the server directly:

```bash
npx -y mrmainspring
```

## Repository Layout

```text
backend/                    TypeScript MCP backend and npm package
backend/src/mcp/            MCP tool registrations
backend/src/memory/         Canonical memory envelopes and hash verification
backend/src/grimoire/       Secret encryption and policy commitments
backend/src/payments/       Payment intents, receipts, policy spend tracking
backend/src/x402/           x402 challenge, signer, facilitator, resource, settlement code
backend/src/casper/         Casper client discovery and anchor command construction
backend/supabase/schema.sql Optional Supabase persistence schema
contracts/memory-anchor/    Casper hash-only memory anchor contract
frontend/                   Public static site
api/                        Vercel proxy endpoint for the browser demo
scripts/                    Public site build and local frontend serve scripts
render.yaml                 Render Blueprint for the public x402 demo API
Dockerfile.render           Demo API Docker image with Node and casper-client
```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `agent.whoami` | Return the generated local default agent identity. |
| `memory.write` | Store a memory envelope, compute content and metadata hashes, optionally request Casper anchoring. |
| `memory.read` | Read one stored memory by agent and memory id. |
| `memory.search` | Search local stored memories with lightweight token matching. |
| `memory.verify` | Recompute the local memory hash and return anchor metadata. |
| `grimoire.secret.put` | Encrypt and store a scoped secret or safe signer reference. |
| `grimoire.secret.list` | Return secret metadata only, never plaintext. |
| `grimoire.policy.set` | Store an allowlisted spending/access policy with a deterministic policy hash. |
| `grimoire.policy.get` | Read policy metadata and current local spend. |
| `payment.fetch` | Create a durable x402 payment intent after policy checks; optionally capture and settle a 402 challenge. |
| `payment.receipt` | Read a persisted payment intent and safe receipt metadata. |
| `audit.tail` | Return recent audit events by agent, event type, or all agents. |

## Develop Locally

Install and test the backend:

```bash
cd backend
npm install
npm test
npm run build
```

Run the local MCP stdio demo:

```bash
npm run demo:stdio
```

The demo starts the compiled server through MCP stdio and verifies the complete local loop: tool listing, generated agent identity, memory write/read/search/verify, encrypted Grimoire storage, policy set/get, policy-approved payment preflight, receipt lookup, and audit tail.

For live TypeScript development:

```bash
cd backend
npm run dev
```

## Run The Public Site

Serve the static frontend locally:

```bash
npm run front:dev
```

It serves `frontend/index.html` at `http://127.0.0.1:4177/`.

Build the frontend only:

```bash
npm run front:build
```

Build the frontend plus docs under `/docs`:

```bash
npm run build
```

The browser demo can call a local backend API when this is running:

```bash
npm run demo:x402-http --prefix backend
```

Local browser requests go to `http://127.0.0.1:4180/demo/x402/payment-fetch`. The Vercel endpoint at `/api/demo/x402/payment-fetch` proxies to `MAINSPRING_DEMO_API_URL`, which should point at a public backend service such as the Render Blueprint in this repository.

## x402 And Casper Testnet

The x402 stack has four code paths:

- `X402ChallengeClient` performs the first HTTP request and parses `PAYMENT-REQUIRED`, `X-PAYMENT-REQUIRED`, JSON body, or raw-body 402 requirements.
- `approveX402Requirements` checks amount, method, resource URL, scheme, network, asset, payee, and timeout against a Grimoire policy.
- Signing can come from `X402_SIGNER_URL` or, in `casper-cli` mode without a signer URL, from the local Casper key path.
- Settlement can run as resource retry, facilitator mode, or direct Casper CLI mode.

The local paid resource exposes `GET /weather`. Without a payment header, it returns `402 Payment Required` plus x402 requirements. With a valid `PAYMENT-SIGNATURE`, it verifies and settles through the facilitator, returns the protected JSON body, and attaches `PAYMENT-RESPONSE` only after settlement verifies.

Run the paid-resource challenge smoke:

```bash
npm run demo:x402-sidecars:smoke --prefix backend
```

Start the resource server for manual testing:

```bash
npm run x402:resource --prefix backend
```

Start the signer and facilitator sidecars:

```bash
npm run x402:signer --prefix backend
npm run x402:facilitator --prefix backend
```

Run the full MCP-driven x402 smoke:

```bash
npm run smoke:x402-payment-fetch --prefix backend
```

That smoke asserts policy spend does not change during preflight, then verifies a settled receipt, a Casper transaction hash, a policy spend increment after settlement, and audit events for `payment.challenge_received`, `payment.settled`, and `policy.spend_recorded`.

## Configure A Casper Testnet Wallet

Use a funded Casper testnet private key outside this repository:

```bash
npx -y mrmainspring wallet setup <absolute-path-outside-repo>/backend.pem
```

The wallet setup flow writes local env values for:

- `CASPER_NETWORK_NAME=casper-test`
- `CASPER_CAIP2_CHAIN_ID=casper:casper-test`
- `CASPER_RPC_URL=https://node.testnet.casper.network/rpc`
- `CASPER_ACCOUNT_KEY_PATH=<your key path>`
- `CASPER_ENABLE_REAL_SUBMISSION=true`
- `X402_ENABLE_REAL_SETTLEMENT=true`
- `X402_SETTLEMENT_MODE=casper-cli`
- `X402_BUYER_PRIVATE_KEY_PATH=<your key path>`
- `X402_BUYER_PUBLIC_KEY=<derived public key>`
- `X402_BUYER_ACCOUNT_HASH=<derived account hash when available>`

For real x402 resource settlement, also provide the payee/resource values required by the demo:

```env
X402_PAY_TO=<payee public key or account-hash>
X402_RESOURCE_AMOUNT=2500000000
X402_ASSET_ID=casper-native-cspr
```

Native CSPR amounts are integer motes. `2500000000` is 2.5 CSPR.

## Casper Memory Anchoring

`contracts/memory-anchor/` contains the on-chain hash-only contract. Its public entry point, `anchor_memory`, stores:

- `anchor_id`
- `agent_id_hash`
- `memory_id_hash`
- `content_hash`
- `metadata_hash`
- `prev_anchor_hash`

It rejects malformed hashes and duplicate anchors. It does not store memory text, secret values, private keys, signed payment payloads, or user data.

Build the contract:

```bash
rustup target add wasm32-unknown-unknown
cd contracts/memory-anchor
cargo build --release --target wasm32-unknown-unknown
```

Backend anchoring is gated by config. If the Casper contract or real submission is not configured, `memory.write` and `memory.verify` return honest `pending`, `failed`, or `not_requested` states instead of pretending that on-chain verification happened.

## Storage

The default storage backend is local JSON files under the user's Mr Mainspring app data directory, or under `SIGIL_DATA_DIR` when explicitly set.

Set `SIGIL_STORAGE_BACKEND=supabase` only after applying:

```text
backend/supabase/schema.sql
```

The Supabase schema stores domain records as JSONB with indexed lookup columns for the access patterns used by the current store interfaces.

## Security Boundaries

Mr Mainspring is intentionally strict about what it proves:

- Real Casper submission is disabled until `CASPER_ENABLE_REAL_SUBMISSION=true`.
- Real x402 settlement is disabled until `X402_ENABLE_REAL_SETTLEMENT=true`.
- Private keys must live outside the repository workspace.
- Grimoire returns secret metadata only.
- Payment receipts store signed payload hashes and redacted settlement receipts, not signed payload bodies.
- Memory anchoring stores hashes only.
- `casper-cli` x402 settlement polls `casper-client get-transaction` before accepting a settled receipt.
- Memory anchoring submits a Casper transaction and polls `casper-client get-transaction` before marking the local anchor as confirmed.

The project should return unavailable-settlement and pending-anchor states unless the required external signer, paid resource, facilitator, Casper key, and Casper RPC path are actually configured and verified.

## Deploy The Demo API

The repository includes a Render Blueprint:

```bash
render.yaml
Dockerfile.render
```

The Docker image installs backend dependencies and `casper-client`, then runs:

```bash
npm run demo:x402-http --prefix backend
```

The Render service exposes:

- `GET /health`
- `GET /weather`
- `POST /demo/x402/payment-fetch`

Set the Vercel frontend proxy target to the Render origin:

```env
MAINSPRING_DEMO_API_URL=https://mainspring-x402-demo-api.onrender.com
```

Do not point the public Vercel function at `127.0.0.1`; the sidecars and Casper settlement path must run on a reachable backend service.

## Verification

Use these commands before publishing changes:

```bash
cd backend
npm test
npm run build

cd ..
npm run build
git status --short
```

The backend tests cover canonical memory hashing, memory search and verification, file stores, Supabase stores, local agent identity, Grimoire encryption and policy hashing, payment policy allow/deny behavior, durable payment intents and idempotency, x402 challenge parsing, requirement approval, signer validation, paid resource retry, facilitator validation and replay protection, Casper command construction, Casper client discovery, MCP stdio, CLI setup flows, env file handling, audit events, and security leak guards.

## License

The backend npm package is MIT licensed. See `backend/LICENSE`.
