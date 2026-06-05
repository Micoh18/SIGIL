---
title: Quickstart
description: Install and run the Mr Mainspring backend MCP server from a local checkout.
section: Start
status: current
last_verified: 2026-06-05
---

# Quickstart

Mr Mainspring currently runs as a backend-only MCP server. The repo does not require a frontend to exercise the core memory, Grimoire, payment, and audit flows.

## What You Can Verify Today

| Capability | Local Check |
| --- | --- |
| MCP backend builds | `npm run build --prefix backend` |
| Backend behavior is covered by tests | `npm test --prefix backend` |
| Optional Supabase store adapter works at the HTTP boundary | `npm test --prefix backend` includes mocked Supabase REST coverage. |
| Docs and LLM artifacts build | `npm.cmd run build --prefix docs-site` |
| Tool schemas are machine-readable | Open `/api/tool-schemas.json` after preview or read `docs-site/docs/public/api/tool-schemas.json`. |
| Current limits are explicit | Read [Current Limitations](/current-limitations) and [Payments and x402](/payments-x402). |

## Install Backend Dependencies

From the repository root:

```bash
npm install --prefix backend
npm test --prefix backend
npm run build --prefix backend
```

For development without a prior build:

```bash
npm run dev --prefix backend
```

For stdio MCP execution after building:

```bash
npm run mcp:stdio --prefix backend
```

## Configure Local Environment

Copy the root template:

```bash
cp .env.example .env
```

Generate a local 32-byte Grimoire key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set the generated value as `GRIMOIRE_MASTER_KEY`.

Important local defaults:

| Variable | Current Use |
| --- | --- |
| `SIGIL_DATA_DIR` | JSON-file stores for memory, Grimoire, payments, and audit. Defaults to `.sigil/`. |
| `SIGIL_STORAGE_BACKEND` | `file` by default. Set `supabase` only after applying `backend/supabase/schema.sql`. |
| `PROJECT_URL` | Supabase project URL for optional remote persistence. |
| `SECRET_KEY` / `PUBLISHABLE_KEY` | Supabase REST key. Prefer `SECRET_KEY` only in private backend env, never in committed files. |
| `SUPABASE_DB_SCHEMA` | Supabase schema, defaulting to `public`. |
| `SUPABASE_TABLE_PREFIX` | Table prefix, defaulting to `sigil_`. |
| `GRIMOIRE_MASTER_KEY` | AES-GCM local encryption key. Omitted values use a deterministic development key only. |
| `X402_FACILITATOR_URL` | Configured facilitator URL, defaulting to `http://localhost:4022`. |
| `X402_RESOURCE_DEMO_URL` | Demo resource URL, defaulting to `http://localhost:4021/weather`. |
| `CASPER_NETWORK_NAME` | Casper chain name, defaulting to `casper-test`. |
| `CASPER_CAIP2_CHAIN_ID` | Defaults to `casper:casper-test`. |
| `CASPER_RPC_URL` | Casper node RPC address required for real anchoring. |
| `CASPER_ACCOUNT_KEY_PATH` | Secret key path required for real anchoring. |
| `MEMORY_ANCHOR_CONTRACT_HASH` | Required before the configured Casper anchor client path can be selected. |
| `MEMORY_ANCHOR_PACKAGE_HASH` | Required with the contract hash before the configured Casper anchor client path can be selected. |

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

Use an MCP client connected to the stdio command and run:

1. `grimoire.secret.put` to store a local signing/API secret reference.
2. `grimoire.policy.set` to allow a demo URL, method, amount, asset, and secret scope.
3. `payment.fetch` with the policy id to create a durable payment intent.
4. `memory.write` to store a result or decision.
5. `memory.verify` to confirm local canonical hash integrity.
6. `audit.tail` to inspect the story.

::: tip Current x402 behavior
Set `request_challenge: true` on `payment.fetch` to make the initial HTTP request and persist a `402 Payment Required` challenge if one is returned. Mr Mainspring still stops before signed payment payload creation and settlement.
:::

## Expected Boundary

A successful quickstart demonstrates local backend correctness, deterministic records, and readable generated docs. It does not demonstrate production persistence, remote transport, real Casper transaction submission, or real x402 settlement.
