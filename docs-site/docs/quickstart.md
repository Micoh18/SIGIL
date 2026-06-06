---
title: Quickstart
description: Install and run the Mr Mainspring MCP server from npm.
section: Start
status: current
last_verified: 2026-06-05
---

# Quickstart

Mr Mainspring runs as a backend-only MCP server. Install the published npm package, then point your MCP-compatible client at the `mainspring` command.

## What You Can Verify Today

| Capability | Local Check |
| --- | --- |
| MCP server installs | `npm install -g mrmainspring` |
| Backend behavior is covered by tests | `npm test --prefix backend` |
| Optional Supabase store adapter works at the HTTP boundary | `npm test --prefix backend` includes mocked Supabase REST coverage. |
| Docs and LLM artifacts build | `npm.cmd run build --prefix docs-site` |
| Tool schemas are machine-readable | Open `/api/tool-schemas.json` after preview or read `docs-site/docs/public/api/tool-schemas.json`. |
| Current limits are explicit | Read [Current Limitations](/current-limitations) and [Payments and x402](/payments-x402). |
| Real Casper x402 settlement | Follow [Casper x402 Runbook](/casper-x402-runbook) with funded testnet keys and `CASPER_ENABLE_REAL_SUBMISSION=true`. |

## Install The MCP Server

Install the published package globally:

```bash
npm install -g mrmainspring

# Create local config and print the MCP snippet
mainspring setup claude
# or: mainspring setup cursor
```

Paste the printed JSON into your MCP client configuration:

```json
{
  "mcpServers": {
    "mainspring": {
      "command": "mainspring"
    }
  }
}
```

## Configure Local Environment

No wallet, hosted account, or environment variable is required for local memory, Grimoire, audit, or payment preflight tools. `mainspring setup` creates a private config file, data directory, and logs directory under the user's standard app config folder.

Useful local checks:

```bash
mainspring doctor
mainspring config
```

For local development from this repository, you can still copy the root template:

```bash
cp .env.example .env
```

If `GRIMOIRE_MASTER_KEY` is missing, Mainspring generates one automatically for local use. Keep real keys and secrets outside the repository.

Important local defaults:

| Variable | Current Use |
| --- | --- |
| `SIGIL_ENV_FILE` | Optional explicit path to a local env file. If unset, the backend checks the user's Mr Mainspring app config first, then existing local `.env` files for development. |
| `SIGIL_DATA_DIR` | JSON-file stores for memory, Grimoire, payments, and audit. Defaults to the user's Mr Mainspring app data directory. |
| `SIGIL_STORAGE_BACKEND` | `file` by default. Set `supabase` only after applying `backend/supabase/schema.sql`. |
| `PROJECT_URL` | Supabase project URL for optional remote persistence. |
| `SECRET_KEY` / `PUBLISHABLE_KEY` | Supabase REST key. Prefer `SECRET_KEY` only in private backend env, never in committed files. |
| `SUPABASE_DB_SCHEMA` | Supabase schema, defaulting to `public`. |
| `SUPABASE_TABLE_PREFIX` | Table prefix, defaulting to `sigil_`. |
| `GRIMOIRE_MASTER_KEY` | AES-GCM local encryption key. Generated automatically for local use when omitted. |
| `X402_FACILITATOR_URL` | Configured facilitator URL, defaulting to `http://localhost:4022`. |
| `X402_RESOURCE_DEMO_URL` | Demo resource URL, defaulting to `http://localhost:4021/weather`. |
| `X402_ENABLE_REAL_SETTLEMENT` | Enables the real settlement provider only when set to `true`. Defaults to disabled. |
| `X402_SETTLEMENT_MODE` | `resource-retry` by default. Use `facilitator` only for direct facilitator tests. |
| `X402_SIGNER_URL` | External signer sidecar URL. Required for real paid retry. |
| `X402_PAYMENT_HEADER_NAME` | Header used for paid retry. Defaults to `PAYMENT-SIGNATURE`. |
| `CASPER_NETWORK_NAME` | Casper chain name, defaulting to `casper-test`. |
| `CASPER_CAIP2_CHAIN_ID` | Defaults to `casper:casper-test`. |
| `CASPER_RPC_URL` | Casper node RPC address required for real anchoring. |
| `CASPER_ACCOUNT_KEY_PATH` | Secret key path required for real anchoring. |
| `CASPER_ENABLE_REAL_SUBMISSION` | Must be `true` before the backend shells out to `casper-client`. Defaults to disabled. |
| `CASPER_CLIENT_BIN` | CLI executable name/path. Defaults to `casper-client`. |
| `CASPER_CLIENT_WSL_DISTRO` | Optional Windows helper. Set to `Ubuntu` to run `wsl -d Ubuntu -- casper-client ...` while the backend runs on Windows. |
| `CASPER_GAS_PRICE_TOLERANCE` | Casper transaction gas price tolerance. Defaults to `10`. |
| `CASPER_PRICING_MODE` | Casper transaction pricing mode. Defaults to `classic`. |
| `CASPER_ANCHOR_PAYMENT_AMOUNT_MOTES` | Standard payment amount used for anchor transactions. Defaults to `3000000000`. |
| `MEMORY_ANCHOR_CONTRACT_HASH` | Required before the configured Casper anchor client path can be selected. |
| `MEMORY_ANCHOR_PACKAGE_HASH` | Required with the contract hash before the configured Casper anchor client path can be selected. Accepts `package-<hex>`, `hash-<hex>`, or raw hex. |

## Optional Supabase Persistence

Local JSON files remain the fastest path for evaluator demos. To persist records in Supabase instead:

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run `backend/supabase/schema.sql`.
4. Set these values in `.env`:

```bash
SIGIL_STORAGE_BACKEND=supabase
PROJECT_URL=https://<project-ref>.supabase.co
SECRET_KEY=<server-side-key>
SUPABASE_DB_SCHEMA=public
SUPABASE_TABLE_PREFIX=sigil_
```

Then run:

```bash
npm test --prefix backend
npm run build --prefix backend
```

The adapter uses Supabase REST tables and keeps each current domain object in a `record jsonb` column. It is useful for remote demo persistence while the richer production database schema remains future work.

## Verify Documentation Artifacts

The docs site publishes both human pages and LLM-readable files. From the repository root:

```bash
npm.cmd run docs:llms --prefix docs-site
npm.cmd run build --prefix docs-site
```

Optional local preview:

```bash
npm.cmd run preview --prefix docs-site -- --port 4176
```

Check these generated routes or files:

```text
/llms.txt
/llms-full.txt
/api/tool-schemas.json
```

The generated files should describe implemented tools, current real capabilities, and the same Casper/x402 limitations as the visible docs.

## First Tool Flow

Use an MCP client connected to the `mainspring` command and run:

1. `grimoire.secret.put` to store a local signing/API secret reference.
2. `grimoire.policy.set` to allow a demo URL, method, amount, asset, and secret scope.
3. `payment.fetch` with the policy id to create a durable payment intent.
4. `memory.write` to store a result or decision.
5. `memory.verify` to confirm local canonical hash integrity.
6. `audit.tail` to inspect the story.

::: tip Current x402 behavior
Set `request_challenge: true` on `payment.fetch` to make the initial HTTP request and persist a `402 Payment Required` challenge if one is returned. By default Mr Mainspring stops before settlement. With `X402_ENABLE_REAL_SETTLEMENT=true`, `X402_SIGNER_URL`, `CASPER_ENABLE_REAL_SUBMISSION=true`, a funded key, and the sidecars from [Casper x402 Runbook](/casper-x402-runbook), it retries the resource with `PAYMENT-SIGNATURE` and persists a settled receipt only when `PAYMENT-RESPONSE` verifies with a Casper transaction hash.
:::

## Expected Boundary

A successful default quickstart demonstrates local backend correctness, deterministic records, and readable generated docs. It does not demonstrate production persistence, remote transport, verified Casper execution, or real x402 settlement unless you configure a signer/resource/facilitator path. Real Casper submission requires the deployed contract hashes, `casper-client`, and the Casper env described in [Casper Anchoring](/casper-anchoring).
