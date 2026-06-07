# Changelog

## 0.3.3 - 2026-06-07
- Add `mainspring wallet setup <path-to-casper-testnet-key.pem>` for testnet-only wallet configuration.
- Enable real Casper submission and x402 settlement defaults during wallet setup.
- Update docs to avoid unnecessary manual env setup for normal users.

## 0.3.2 — 2026-06-06
- Windows: auto-detect `casper-client` inside WSL when no native Windows binary is available.
- `mainspring doctor` now reports the resolved WSL distro/path and no longer treats a failed WSL process as available.

## 0.1.8 — 2026-06-06
- x402: local Casper signing — no external signer service required
- Set `X402_ENABLE_REAL_SETTLEMENT=true`, `X402_SETTLEMENT_MODE=casper-cli` to activate
- `CASPER_ACCOUNT_KEY_PATH` PEM key used directly for payment authorization signing
- Optional `X402_BUYER_ACCOUNT_HASH` override for secp256k1 keys

## 0.1.6 — 2026-06-06
- Demo: verify hash integrity and simulate tamper attack in the browser
- Demo: 5 diverse presets (Treasury, Invoice, Code PR, Halt, Research)
- Demo: copyable full SHA-256 hashes on every receipt field
- Auto-detect and configure Claude Desktop, Cursor, Windsurf, Zed, Claude Code, Continue.dev, VS Code on `mainspring setup`
- `@micoh/mainspring` deprecated on npm — use `mrmainspring`

## 0.1.5 — 2026-06-06
- Remove client-specific `setup cursor` arg — works with any MCP host
- Doc: Installation section updated to reflect auto-configure flow

## 0.1.4 — 2026-06-06
- Read VERSION from `package.json` at runtime — never drifts from npm version

## 0.1.3 — 2026-06-06
- `mainspring doctor` now checks whether `casper-client` is available
- Add `mainspring update` command
- MCP config now uses `npx -y mrmainspring` — no global install required
- Fix: CTA command simplified to `npx -y mrmainspring setup cursor`

## 0.1.2 — 2026-06-06
- Add `mrmainspring` bin alias so `npx mrmainspring` works directly
- Fix: ignore `CASPER_CLIENT_WSL_DISTRO` on macOS and Linux — was causing casper-client spawn to fail

## 0.1.1 — 2026-06-06
- Auto-generate `GRIMOIRE_MASTER_KEY` on first run — no manual config required
- Real Casper testnet anchoring verified end-to-end
- Cleaned up backend lockfile

## 0.1.0 — 2026-06-05
- Initial release
- MCP stdio server with 11 tools: memory, Grimoire, payments, audit
- File and Supabase storage backends
- Casper on-chain memory anchoring (hash only)
- x402 payment policy enforcement (settlement boundary stubs)
- AES-256-GCM Grimoire encryption
