- The service talks to GitHub only through `src/github.ts` and to Claude only through `claude -p`;
  tests mock `gh` or test the pure functions (needsTriage, verdictActions, buildDecision, …).
- Never run the updater against real GitHub from a session (`pnpm updater …`); that posts on real
  issues. A human does that from the container.
- Keep the triage session read-only (`TRIAGE_ALLOWED`), and never let a verdict close a quarantine
  issue.
