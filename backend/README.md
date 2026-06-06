# Mr Mainspring

Installable MCP backend for local agent demos. It exposes memory, Grimoire
policy/secret storage, payment intent tools, audit trail tools, Casper anchoring
boundaries, and x402 settlement-provider wiring.

## Install

```bash
npm install -g mainspring
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

The server loads `.env` from the current directory, backend directory, or repo
root. Use `SIGIL_ENV_FILE` to point at a specific env file.

Important package boundaries:

- Keep `.env`, `.sigil/`, local keys, and generated demo data outside the npm
  package.
- Real Casper submission remains gated by `CASPER_ENABLE_REAL_SUBMISSION=true`.
- Real x402 settlement remains gated by `X402_ENABLE_REAL_SETTLEMENT=true` and
  a configured `X402_SIGNER_URL`.
- The signer private key must live outside the repository workspace.

## Library Entry

```ts
import { createSigilServer } from "mainspring";
```

The CLI entry is also exported as `mainspring/mcp`, but importing it starts
the stdio server; use the package bin for normal MCP client configuration.
