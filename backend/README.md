# Mr Mainspring

Installable MCP stdio backend for agent memory, Grimoire secrets and policies, audit trails, Casper hash anchoring, and policy-gated x402 payment receipts.

## Install

No global install is required:

```bash
npx -y mrmainspring setup
```

The setup command creates local config, data, logs, a generated `agent_id`, and a `GRIMOIRE_MASTER_KEY` under the user's standard app config folder. It also auto-configures detected MCP clients when possible.

Manual MCP config:

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

Run the server directly:

```bash
npx -y mrmainspring
```

Check the setup:

```bash
npx -y mrmainspring doctor
```

## Tools

- `agent.whoami`
- `memory.write`
- `memory.read`
- `memory.search`
- `memory.verify`
- `grimoire.secret.put`
- `grimoire.secret.list`
- `grimoire.policy.set`
- `grimoire.policy.get`
- `payment.fetch`
- `payment.receipt`
- `audit.tail`

## Local Development

```bash
npm install
npm test
npm run build
npm run demo:stdio
```

For live TypeScript development:

```bash
npm run dev
```

## Casper And x402

Local memory, Grimoire, audit, and payment preflight tools require no environment variables. Real Casper submission and real x402 settlement are gated until explicitly enabled.

Configure a funded Casper testnet wallet with a key stored outside the repository:

```bash
npx -y mrmainspring wallet setup <absolute-path-outside-repo>/backend.pem
```

This writes Casper testnet RPC/account settings and enables:

- `CASPER_ENABLE_REAL_SUBMISSION=true`
- `X402_ENABLE_REAL_SETTLEMENT=true`
- `X402_SETTLEMENT_MODE=casper-cli`

For real x402 resource settlement, also provide the resource and payee values required by your paid resource, such as `X402_PAY_TO`, `X402_RESOURCE_AMOUNT`, and `X402_ASSET_ID`.

## Library Entry

```ts
import { createSigilServer } from "mrmainspring";
```

The package also exports `mrmainspring/mcp`, but importing that entry starts the stdio server. Use the package binary for normal MCP client configuration.

## Boundaries

- Secrets are encrypted and returned only as metadata.
- Payment receipts store safe metadata and signed payload hashes, not signed payload bodies.
- Casper memory anchoring stores hashes only.
- The backend returns pending or unavailable states unless real Casper or x402 settlement is configured and verified.
