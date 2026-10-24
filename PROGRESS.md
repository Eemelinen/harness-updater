# Progress log

Repository-local session log. Read it at clock-in, update it at clock-out (AGENTS.md). The
session-start hook prints the `## Current Verified State` section and the clean-state check requires
this file to change on every branch; keep that heading text exactly.

## Current Verified State

- Repository root: `harness-updater/`.
- Standard startup path: `./init.sh` (`FAST=1` skips the baseline).
- Standard verification path: L1 `pnpm check`. Per feature: `pnpm harness:verify F-NNN`.
- The service is live: the container has run in `full` mode since 2026-10-24 (`docker compose ps`,
  `docker compose exec updater updater status`), and the harness gates its retro intake on
  `updater:accepted`.
- Last verified: F-004 on `feat/F-004`, `pnpm check` green on 2026-10-24. Every feature is passing.
- Current blocker: none.

## Next Steps

1. Review and merge harness PR Eemelinen/harness#23 (F-015 from #20). It changes the guard hooks
   and `src/config.ts` (harness `reviewPaths`), so it waits for a human.
2. #21 and #22 are accepted and are built in the next cycles, within `build.maxPerDay` (4). Their PRs
   may also wait for review.
3. Don't run `pnpm harness:loop` in the harness repository by hand while the updater is in `full`
   mode (README.md → Going live).

## Session Log

### Session 004 — 2026-10-24 (F-004 go live)

- Goal: F-004. Run the updater against real GitHub through observe → triage → full, with the
  harness intake gate.
- Observed:
  - The maintainer had set up `.env` and started the container. Observe mode logged #11
    (`rejected (fixed) [logged only]`).
  - The harness `main` sets `retro.intakeLabel: "updater:accepted"`.
  - The container runs in `full` mode. In the 18:44 UTC cycle it triaged and accepted #20, #21
    and #22, posting a verdict comment and the `updater:accepted` label on each.
  - It then ran `harness loop --once` in `/data/harness`. That took #20 in as harness F-015, built
    it, got an evaluator Accept, and opened Eemelinen/harness#23.
  - The loop held #23 for a human review because it changes `reviewPaths` files.
- No code changes; the service already did what F-004 asks.
- Verification: `pnpm harness:verify F-004 --manual-observed …` (`pnpm check` plus the observed
  go-live).
- Next best step: review harness#23. Watch #21 and #22 build in the next cycles.

### Session 003 — 2026-10-24 (hardening)

- `.claude/settings.json` drops the `Write(...)` deny rules that Claude Code ignores; `Edit(...)`
  covers every file-editing tool.
- The five repositories accept issues, PRs and comments only from collaborators until 2027-04-24
  (README.md → Interaction limits has the renewal command).
- Both tokens were tested in the container: Claude answers, and the GitHub token can push to and
  read issues of all five repositories.
- First live triage (#11, the v0.3.2 quarantine), with two fixes:
  - Claude Code rejected the `--json-schema` because zod adds a `$schema` meta-schema line; the
    updater now drops that line, and logs stderr when a session fails to start.
  - Chained read commands (`cd … && git log`, `tail`) were denied; the allowlist now includes
    those read-only parts.

  The verdict: needs-human (cause unknown from the evidence), with a refined feature that captures
  a restarted driver's output. $0.98, 34 turns, 2 min.

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
