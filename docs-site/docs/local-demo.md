---
title: Local Demo
description: Scripted local MCP stdio demo for memory, Grimoire, x402 pre-settlement, receipts, and audit.
section: Start
status: current
last_verified: 2026-06-05
---

# Local Demo

Use the scripted evaluator path when you want the backend to feel presentable without claiming unfinished settlement work.

```bash
cd backend
npm run demo:stdio
```

The command builds the backend, starts the same MCP stdio entry point exposed by the `mainspring` CLI, writes demo files under the OS temp directory, validates every response, and exits non-zero on failure. It does not write to `.sigil/`.
The script sets an explicit missing `SIGIL_ENV_FILE`, so it does not pick up real Casper/Supabase/x402 settings from your local `.env`.

NPM prints normal script headers first. The stable transcript begins with:

```text
Mr Mainspring evaluator stdio demo
data_dir=<os-temp>/mr-mainspring-evaluator-stdio-demo
server=mainspring
scope=local-only casper_transaction_hash=null x402_settlement=not_started
PASS tools/list: 11 required tools available
PASS memory.write: memory_id=mem_evaluator_stdio_demo anchor_status=pending content_hash=<64-hex>
PASS memory.read: found=true memory_id=mem_evaluator_stdio_demo
PASS memory.search: query="Evaluator demo memory" count=1
PASS memory.verify: valid=true anchor_status=pending casper_transaction_hash=null onchain_content_hash=null
PASS grimoire.secret.put: status=stored name=demo_x402_key value=<not returned>
PASS grimoire.secret.list: count=1 value=<not returned>
PASS grimoire.policy.set: status=stored policy_id=pol_evaluator_weather allowed_methods=GET policy_hash=<64-hex>
PASS grimoire.policy.get: found=true current_period_spend=0
PASS payment.fetch: allowed=true status=policy_checked next_state=challenge_received settlement=not_started payment_id=<pay_...>
PASS payment.receipt: found=true intent_status=policy_checked signed_payload_hash=null receipt=null
PASS audit.tail: count=8 events=memory.created,memory.verify_succeeded,payment.policy_approved,policy.get,policy.set,secret.listed,secret.stored
RESULT PASS
```

## Tool Coverage

The runner exercises the real MCP stdio transport and calls:

```text
memory.write
memory.read
memory.search
memory.verify
grimoire.secret.put
grimoire.secret.list
grimoire.policy.set
grimoire.policy.get
payment.fetch
payment.receipt
audit.tail
```

## Honest Limits

`payment.fetch` stops at `status: "policy_checked"` with `settlement: "not_started"` because this scripted demo intentionally avoids the real signer/resource/facilitator path. Use [Casper x402 Runbook](/casper-x402-runbook) for real native CSPR settlement. `memory.verify` keeps `casper_transaction_hash: null` and `onchain_content_hash: null` because this scripted demo intentionally uses the local pending anchor path, not the configured Casper CLI submission path.

For the full manual command sequence, use `docs/demo-runbook.md` in the repository root.
