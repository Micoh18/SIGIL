# Changelog

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
