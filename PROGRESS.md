# Progress log

Repository-local session log. Read it at clock-in, update it at clock-out (AGENTS.md). The
session-start hook prints the `## Current Verified State` section and the clean-state check requires
this file to change on every branch; keep that heading text exactly.

## Current Verified State

- Repository root: `harness-updater/`.
- Standard startup path: `./init.sh` (`FAST=1` skips the baseline).
- Standard verification path: L1 `pnpm check`. Per feature: `pnpm harness:verify F-NNN`.
- The service runs in Docker (`docker compose up -d --build`); the image builds; it is not started yet.
- Last verified: F-003 on this branch, `pnpm check` green on 2026-10-24.
- Current blocker: going live needs the tokens in `.env` (F-004, human-only).

## Next Steps

1. Merge `feat/service` (F-001…F-003).
2. F-004 (needs the maintainer): tokens, then `observe` → `triage` → harness `retro.intakeLabel` →
   `full` (README.md → Going live).

## Session Log

### Session 003 — 2026-10-24 (hardening)

- `.claude/settings.json` drops the `Write(...)` deny rules that Claude Code ignores; `Edit(...)`
  covers every file-editing tool.
- The five repositories accept issues, PRs and comments only from collaborators until 2027-04-24
  (README.md → Interaction limits has the renewal command).
- Both tokens were tested in the container: Claude answers, and the GitHub token can push to and
  read issues of all five repositories.

### Session 002 — 2026-10-24 (the service)

- F-001: the survey finds the owner's repositories that depend on the harness (or the configured
  list), records per consumer its pin, rollout settings, merge policy, retro settings, CI and open
  retro issues, plus a runs.jsonl summary for checkouts on this machine. The updater keeps its own
  clones in `/data`, which it resets at will. Checked live (read-only): it found idea-generator,
  metsavahti and personal-finances on v0.3.1. Verification: `pnpm harness:verify F-001`.
- F-002: triage selects the owner's open retro issues without a verdict (or reopened, or commented
  since) and runs one read-only session each (`dontAsk`, read-only Bash only, schema-checked
  verdict). Verdicts become a comment with a per-consumer table and an `updater:*` label. A refined
  feature block replaces the old one. A rejection closes the issue as not planned, except on a
  quarantine issue, where it becomes needs-human (D-003). Prettier is kept off `prompts/` so the
  `~~~~` data fence survives. Verification: `pnpm harness:verify F-002`.
- F-003: in full mode, an accepted unqueued issue starts one `harness loop --once` in the harness
  clone, within `build.maxPerDay`, and only while the harness config gates its intake on
  `updater:accepted`. Without the gate the loop could build issues triage never accepted. The
  daemon runs cycles under a lock and stops cleanly on SIGTERM; `updater status|survey|issues|
triage|health|once` work in the container. The image (node 22, gh, Claude Code 2.1.310, uid 1001) builds, refuses to start without tokens, runs the CLI, and reads the host projects through
  the read-only mount; CI builds it too. Verification: `pnpm harness:verify F-003`, plus
  `docker build` and container smoke runs.

### Session 001 — 2026-10-24 (scaffold)

- Goal: a service that triages harness issues against the repositories that use the harness and
  has the harness loop build the accepted ones.
- Completed: tooling (TypeScript, Vitest, Prettier, husky, commitlint, CI), harness adoption at
  v0.3.3 (AGENTS.md, harness.config.json, plugin pin), the config module, and the secrets check
  for this public repository.
- Verification: `pnpm harness:verify F-000` → L1 `pnpm check` and `pnpm harness:doctor` pass.
