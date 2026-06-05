---
title: Quickstart
description: Install and run the Mr Mainspring backend MCP server from a local checkout.
section: Start
status: current
last_verified: 2026-06-05
---

# Quickstart

Mr Mainspring currently runs as a backend-only MCP server. The repo does not require a frontend to exercise the core memory, Grimoire, payment, and audit flows.

## Install Backend Dependencies

```bash
cd backend
npm install
npm test
npm run build
```

For development without a prior build:

```bash
cd backend
npm run dev
```

For stdio MCP execution after building:

```bash
cd backend
npm run mcp:stdio
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
| `GRIMOIRE_MASTER_KEY` | AES-GCM local encryption key. Omitted values use a deterministic development key only. |
| `X402_FACILITATOR_URL` | Configured facilitator URL, defaulting to `http://localhost:4022`. |
| `X402_RESOURCE_DEMO_URL` | Demo resource URL, defaulting to `http://localhost:4021/weather`. |
| `CASPER_CAIP2_CHAIN_ID` | Defaults to `casper:casper-test`. |
| `MEMORY_ANCHOR_CONTRACT_HASH` | Required before the configured Casper anchor client path can be selected. |

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
