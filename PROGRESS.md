# Progress log

Repository-local session log. Read it at clock-in, update it at clock-out (AGENTS.md). The
session-start hook prints the `## Current Verified State` section and the clean-state check requires
this file to change on every branch; keep that heading text exactly.

## Current Verified State

- Repository root: `harness-updater/`.
- Standard startup path: `./init.sh` (`FAST=1` skips the baseline).
- Standard verification path: L1 `pnpm check`. Per feature: `pnpm harness:verify F-NNN`.
- The service runs in Docker (`docker compose up -d --build`); it is not started yet.
- Last verified: F-000 on this commit, `pnpm check` green on 2026-10-24.
- Current blocker: going live needs the tokens in `.env` (F-004, human-only).

## Next Steps

1. F-001…F-003: survey and sync, triage, build and the container.
2. F-004 (needs the maintainer): tokens, then `observe` → `triage` → harness `retro.intakeLabel` →
   `full` (README.md → Going live).

## Session Log

### Session 001 — 2026-10-24 (scaffold)

- Goal: a service that triages harness issues against the repositories that use the harness and
  has the harness loop build the accepted ones.
- Completed: tooling (TypeScript, Vitest, Prettier, husky, commitlint, CI), harness adoption at
  v0.3.3 (AGENTS.md, harness.config.json, plugin pin), the config module, and the secrets check
  for this public repository.
- Verification: `pnpm harness:verify F-000` → L1 `pnpm check` and `pnpm harness:doctor` pass.
