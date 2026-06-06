# Mr Mainspring

Installable MCP backend for local agent demos. It exposes memory, Grimoire
policy/secret storage, payment intent tools, audit trail tools, Casper anchoring
boundaries, and x402 settlement-provider wiring.

## Install

```bash
npm install -g mrmainspring
mainspring setup cursor
```

Run the stdio MCP server:

```bash
mainspring
```

For local development from this repository:

```bash
npm run build
npm run mcp:stdio
```

## Environment

No environment variables are required for local memory, Grimoire, audit, or
payment preflight tools. `mainspring setup` creates the local config, data, and
logs directories plus a generated stable `agent_id` under the user's standard app config folder. Use
`SIGIL_ENV_FILE` to point at a specific env file for advanced setups.

Important package boundaries:

- Keep `.env`, local keys, and generated demo data outside the npm package.
- Real Casper submission remains gated by `CASPER_ENABLE_REAL_SUBMISSION=true`.
- Real x402 settlement remains gated by `X402_ENABLE_REAL_SETTLEMENT=true` and
  a configured `X402_SIGNER_URL`.
- The signer private key must live outside the repository workspace.

## Library Entry

```ts
import { createSigilServer } from "mrmainspring";
```

The CLI entry is also exported as `mrmainspring/mcp`, but importing it starts
the stdio server; use the package bin for normal MCP client configuration.
