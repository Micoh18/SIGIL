---
title: Overview
description: Mr Mainspring is a local-first MCP backend for agent memory, Grimoire policies/secrets, Casper anchoring metadata, and x402 payment workflows.
section: Start
status: current
last_verified: 2026-06-05
layout: home
hero:
  name: Mr Mainspring
  text: Verifiable memory, Grimoire controls, and x402 payment flow for local agents.
  tagline: Run a TypeScript stdio MCP server that stores canonical memory records, encrypts Grimoire secrets, enforces allowlisted x402 policies, captures 402 challenges, retries paid resources with a signer sidecar when enabled, and can submit hash-only Casper memory anchors when explicitly enabled.
  actions:
    - theme: brand
      text: Verify Locally
      link: /quickstart
    - theme: alt
      text: Evaluator Demo
      link: /local-demo
    - theme: alt
      text: LLM Docs
      link: /llms.txt
  image:
    src: /sigil-mark.svg
    alt: Mr Mainspring mark
features:
  - title: Run
    details: Build and run the backend-only MCP server through stdio with repo-local TypeScript scripts.
  - title: Verify
    details: Exercise memory hashes, Grimoire policies, x402 payment intents, and redacted audit events from one local flow.
  - title: Inspect
    details: Read generated /llms.txt, /llms-full.txt, and /api/tool-schemas.json files for machine-readable status and schema context.
  - title: Boundaries
    details: Casper transaction submission and x402 paid retry are behind explicit env gates; automatic finality checks, native Casper x402 signing, remote HTTP MCP transport, and production databases remain explicit limitations.
---

## Evaluator Snapshot

Mr Mainspring is a TypeScript MCP backend for local agent demos. It is currently useful for evaluating the backend contract around:

- Memory write/read/search/verify.
- Grimoire encrypted secrets and deterministic spending/access policies.
- x402 payment intent preflight, idempotency, optional 402 challenge capture, and signer-backed paid retry when configured.
- Audit event tailing.
- Casper anchor metadata through a replaceable client interface, including a verified testnet submission path when configured.

::: warning Honest status
The memory-anchor contract is deployed on Casper testnet and real anchor submission has been smoke-tested. The backend still reports submitted anchors as `pending` until a separate `get-transaction`/on-chain query verifies execution. x402 settlement remains disabled by default; the [Casper x402 Runbook](/casper-x402-runbook) is the real native CSPR path for signer/resource/facilitator settlement and transaction-hash verification.
:::

## First 10 Minutes

| Question | Where to Look | Local Signal |
| --- | --- | --- |
| Can the docs and generated LLM files build? | [Quickstart](/quickstart) | `npm.cmd run build --prefix docs-site` completes and regenerates public LLM files. |
| What should an evaluator run? | [Local Demo](/local-demo) | Secret metadata, policy hash, payment intent state, memory hash, and audit events appear in sequence. |
| What is the backend boundary? | [Architecture](/architecture) | MCP stdio enters local services backed by JSON stores under `SIGIL_DATA_DIR`. |
| What is not proven yet? | [Current Limitations](/current-limitations) | Local demos do not prove real settlement; memory-anchor finality checks and production key custody remain separate work. |

## Documentation Map

Start with [Quickstart](/quickstart), then read [Architecture](/architecture) for the five-minute module map. Use [Local Demo](/local-demo) when validating the local implementation path end to end, and [Casper x402 Runbook](/casper-x402-runbook) when validating real on-chain x402 settlement. The core backend surfaces are documented in [MCP Tools](/mcp-tools), [Memory](/memory), [Grimoire](/grimoire), [Payments and x402](/payments-x402), [Casper Anchoring](/casper-anchoring), and [Audit Trail](/audit-trail).

## LLM-Readable Files

LLM-readable entry points are available at [/llms.txt](/llms.txt), [/llms-full.txt](/llms-full.txt), and [/api/tool-schemas.json](/api/tool-schemas.json).
