---
title: Local Demo
description: Suggested local MCP demo sequence for memory, Grimoire, x402 pre-settlement, and audit.
section: Start
status: current
last_verified: 2026-06-05
---

# Local Demo

This demo mirrors `docs/demo-runbook.md` and updates the current x402 state names used by the backend service.

## 1. Verify Backend

```bash
cd backend
npm install
npm test
npm run build
```

## 2. Start MCP Backend

```bash
cd backend
npm run mcp:stdio
```

For live TypeScript development:

```bash
cd backend
npm run dev
```

## 3. Store a Secret

Tool: `grimoire.secret.put`

```json
{
  "agent_id": "agent-demo-1",
  "name": "demo_x402_key",
  "type": "x402_client_key_ref",
  "value": "local-demo-secret-value",
  "scopes": ["x402:sign"]
}
```

Expected: `status: stored` plus secret metadata only.

## 4. Set a Policy

Tool: `grimoire.policy.set`

```json
{
  "agent_id": "agent-demo-1",
  "policy_id": "pol_demo_weather",
  "enabled": true,
  "allowed_urls": ["http://localhost:4021/weather"],
  "allowed_methods": ["GET"],
  "allowed_asset": {
    "caip2_chain_id": "casper:casper-test",
    "asset_package": "demo-asset-package"
  },
  "max_amount_per_call": "0.05",
  "max_amount_per_period": "1.00",
  "period_seconds": 86400,
  "secret_scopes": ["x402:sign"]
}
```

Expected: deterministic `policy_hash`.

## 5. Create a Payment Intent

Tool: `payment.fetch`

```json
{
  "agent_id": "agent-demo-1",
  "policy_id": "pol_demo_weather",
  "method": "GET",
  "url": "http://localhost:4021/weather",
  "expected_amount": "0.01",
  "idempotency_key": "demo-weather-001"
}
```

Expected:

```json
{
  "allowed": true,
  "status": "policy_checked",
  "next_state": "challenge_received",
  "settlement": "not_started"
}
```

To capture a real first HTTP challenge from a running resource server, add:

```json
{
  "request_challenge": true
}
```

## 6. Write and Verify Memory

Tool: `memory.write`

```json
{
  "agent_id": "agent-demo-1",
  "type": "observation",
  "source": {
    "kind": "x402_http",
    "url": "http://localhost:4021/weather"
  },
  "body": {
    "summary": "Weather data purchase preflight completed. Real settlement pending x402 facilitator verification."
  },
  "anchor": true
}
```

Expected current anchor state:

```json
{
  "anchor_status": "pending",
  "casper_transaction_hash": null
}
```

Then call `memory.verify` with the returned `memory_id`.

## 7. Tail Audit

Tool: `audit.tail`

```json
{
  "agent_id": "agent-demo-1",
  "limit": 20
}
```

Expected events include `secret.stored`, `policy.set`, `policy.get`, `payment.policy_approved`, `memory.created`, and `memory.verify_succeeded`.
