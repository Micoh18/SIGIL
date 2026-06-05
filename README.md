# SIGIL

SIGIL is an MCP backend for Casper-native agent memory, Grimoire policies, and x402 payments.

Current focus: backend MCP development.

## Backend

```bash
cd backend
npm install
npm run dev
```

The development server runs as a stdio MCP server by default. It writes local demo data under `.sigil/` unless `SIGIL_DATA_DIR` is set.

Current MCP tools:

- `memory.write`
- `memory.read`
- `memory.search`
- `memory.verify`
- `grimoire.secret.put`
- `grimoire.secret.list`
- `grimoire.policy.set`
- `grimoire.policy.get`
