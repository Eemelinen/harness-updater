@AGENTS.md

## Claude Code specifics

- **Permissions** (`.claude/settings.json`): `pnpm check*`, the test, format and harness scripts,
  read-only git, and `docker ps` / `docker compose ps|logs` run without prompting. Reading or
  editing `.env`, editing the lockfile, force pushes, `git reset --hard` and `docker volume rm` are
  denied.
- **Hooks, skills and the evaluator** come from the harness plugin (`harness@eemelinen-harness`,
  pinned to the same tag as `@eemelinen/harness`). The guard also denies `.env*` edits and stops
  sessions from starting or removing containers (`harness.config.json` → `guard`).
- **Skills:** `/harness:clock-in`, `/harness:verify-feature F-NNN`, `/harness:clock-out`.
