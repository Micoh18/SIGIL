---
title: Overview
description: Mr Mainspring is an MCP backend for agent memory, Grimoire policies/secrets, Casper anchoring, and x402 payments.
section: Start
status: current
last_verified: 2026-06-05
layout: home
hero:
  name: Mr Mainspring
  text: MCP backend for agent memory, Grimoire policies/secrets, Casper anchoring, and x402 payments.
  tagline: Build agent infrastructure with durable local records, encrypted policy controls, hash-only anchoring boundaries, and honest x402 pre-settlement states.
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: MCP Tools
      link: /mcp-tools
features:
  - title: Verifiable Memory
    details: Store canonical memory envelopes, compute deterministic SHA-256 hashes, and track local anchor metadata without exposing memory bodies on-chain.
  - title: Grimoire Controls
    details: Encrypt secrets at rest, return metadata only, and enforce allowlisted spending/access policies before payment flows.
  - title: x402 Pre-Settlement
    details: Persist durable payment intents, optionally capture HTTP 402 requirements, and stop before signed payloads or Casper settlement are verified.
  - title: Casper Boundary
    details: Keep the backend behind a Casper anchor client interface while the current contract remains a source/spec stub.
---

## Current Shape

Mr Mainspring is a TypeScript MCP backend for local agent demos. It exposes tools for:

- Memory write/read/search/verify.
- Grimoire encrypted secrets and policies.
- x402 payment intent preflight and challenge capture.
- Audit event tailing.
- Casper anchor metadata through a replaceable client interface.

::: warning Honest status
Real Casper settlement, real x402 settlement, and a buildable deployed Casper memory-anchor contract are not implemented until they are run and verified. Current anchored writes return local pending metadata unless a real client replaces the placeholder path.
:::

## Documentation Map

Start with [Quickstart](/quickstart), then read [Architecture](/architecture) for the module boundaries. The core backend surfaces are documented in [MCP Tools](/mcp-tools), [Memory](/memory), [Grimoire](/grimoire), [Payments and x402](/payments-x402), [Casper Anchoring](/casper-anchoring), and [Audit Trail](/audit-trail).

LLM-readable entry points are available at [/llms.txt](/llms.txt), [/llms-full.txt](/llms-full.txt), and [/api/tool-schemas.json](/api/tool-schemas.json).
