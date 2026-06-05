---
title: Grimoire
description: Encrypted secrets and spending/access policies for SIGIL agents.
section: Core Modules
status: implemented
last_verified: 2026-06-05
---

# Grimoire

Grimoire is SIGIL's local vault and policy layer. It exists to prevent agents from receiving raw secrets while still allowing backend code to enforce spending and access rules.

## Secrets

Supported secret types:

```text
casper_private_key_ref
x402_client_key_ref
api_key
webhook_secret
```

`grimoire.secret.put` encrypts secret values with AES-256-GCM using `GRIMOIRE_MASTER_KEY`. The tool returns metadata only:

```json
{
  "status": "stored",
  "secret": {
    "id": "sec_...",
    "agent_id": "agent-demo-1",
    "name": "demo_x402_key",
    "type": "x402_client_key_ref",
    "scopes": ["x402:sign"],
    "created_at": "2026-06-05T00:00:00.000Z",
    "updated_at": "2026-06-05T00:00:00.000Z"
  }
}
```

The plaintext `value`, ciphertext internals, auth tag, and nonce are not returned by MCP tools.

## Policies

Policies bind agents to exact URLs, methods, assets, amounts, periods, and required secret scopes.

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

The service canonicalizes policy bodies and stores `policy_hash` so later payment decisions can refer to a stable policy commitment.

## Current Enforcement

`payment.fetch` denies by default when:

- The policy does not exist.
- The policy is disabled.
- The URL is not exactly allowlisted.
- The method is not allowlisted.
- The expected amount is invalid.
- The expected amount exceeds `max_amount_per_call`.

Period spend tracking is represented in the policy record, but real settlement spend updates are not implemented because settlement is not implemented.
