# harness-updater

A small service in local Docker Desktop that keeps the [harness](https://github.com/Eemelinen/harness)
improving itself safely. Every 10 minutes it:

1. **Surveys the repositories that use the harness**: their pinned version, rollout settings, CI
   status, open retro issues, and the loop runs of the ones checked out on this machine.
2. **Triages each new harness issue on its own.** These are the `harness-retro` issues that retros
   file, and the `harness-quarantine` issues that loops file when a release fails. A read-only
   Claude session checks the issue against the survey and the current harness code:
   - Is it a harness defect or one project's setup?
   - Is it still real on `main`, or already fixed?
   - Is it a duplicate?
   - Which consumers does it affect?
   - Is the proposed fix right and small enough?

   It answers on the issue: **accepted**, **rejected** (closed as not planned), or **needs-human**.

3. **Builds the accepted issues** with the harness repository's own loop: one feature, the
   evaluator, a PR. The harness takes it from there: merge gate, release, canary rollout.

## Safety

| Concern                                       | How it is handled                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection (the harness repo is public) | Only issues opened by the owner's account are triaged, and only the owner's comments are read. The issue text is fenced as data. |
| What a triage session may do                  | Read files and run read-only `git`/`gh` commands; everything else is denied without a prompt.                                    |
| A bad rejection                               | It's closed as not planned with the reasoning; reopen it and it is triaged again.                                                |
| Lifting a quarantine                          | Never automatic: a quarantine issue is never closed by the updater; a rejection there becomes needs-human.                       |
| Building what triage didn't accept            | The updater starts the harness loop only when the harness config gates its intake on `updater:accepted` (`retro.intakeLabel`).   |
| Cost                                          | Per session (`triage.maxBudgetUsd`, turns, wall clock), per cycle (`triage.maxPerCycle`) and per day (`build.maxPerDay`).        |
| Your checkouts                                | Mounted read-only, only for reading loop traces. The updater works in its own clones in the `/data` volume.                      |
| Secrets                                       | Only in `.env` on this machine. `pnpm check` and the pre-commit hook fail when a token-like string is tracked.                   |

## Modes

`UPDATER_MODE` in `.env`:

- **`observe`**: survey and triage, log the verdicts, post nothing. Start here.
- **`triage`**: post verdicts on the issues, build nothing.
- **`full`**: post verdicts and build accepted issues.

## Tokens

Both go into `.env` (copy `.env.example`), never into git.

- **`CLAUDE_CODE_OAUTH_TOKEN`**: run `claude setup-token` on the host and paste the token it
  prints. Sessions then use your Claude subscription.
- **`GH_TOKEN`**: a fine-grained personal access token (GitHub → Settings → Developer settings →
  Fine-grained tokens), owner `Eemelinen`, with access to `harness` and every repository that uses
  it:

  | Permission                    | Why                                                                             |
  | ----------------------------- | ------------------------------------------------------------------------------- |
  | Contents: read and write      | Clone the repositories; the harness loop pushes its feature branch to `harness` |
  | Issues: read and write        | Read the issues, post verdicts, set labels                                      |
  | Pull requests: read and write | The harness loop opens and auto-merges its PR                                   |
  | Workflows: read and write     | A harness fix may change `.github/workflows/*`                                  |
  | Actions: read                 | CI status for the survey and the loop's CI wait                                 |
  | Metadata: read                | Required                                                                        |

  Write access is needed on `harness` only. The consumers could be read-only, but one token is
  simpler: the updater never writes to them.

## Running it

```bash
cp .env.example .env        # fill in the tokens and your git name and email
docker compose up -d --build
docker compose logs -f updater
docker compose exec updater updater status
```

Commands inside the container (`docker compose exec updater updater <command>`):

| Command                | What it does                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `status`               | Mode, last cycle, the survey, recent verdicts and builds                         |
| `issues`               | The open harness retro issues the updater would consider                         |
| `survey`               | Survey now and print the table                                                   |
| `triage <n> [--apply]` | Triage one issue and print the verdict; `--apply` posts it (not in observe mode) |
| `once`                 | Run a cycle now                                                                  |

**Going live:**

1. Run in `observe` mode for a few cycles, and read the logged verdicts in `docker compose logs`.
2. Switch to `triage` (edit `.env`, then `docker compose up -d`).
3. Set `retro.intakeLabel: "updater:accepted"` in the harness repo's `harness.config.json`.
4. Switch to `full`.

Once the updater runs in `full` mode, don't also run `pnpm harness:loop` in the harness repo by
hand.

## Configuration

`updater.config.json` (committed, no secrets):

| Key                                                                                 | Default                               | Meaning                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `owner`                                                                             | `Eemelinen`                           | Whose repositories, issues and comments count                                             |
| `harnessRepo`                                                                       | `Eemelinen/harness`                   |                                                                                           |
| `consumers`                                                                         | `null`                                | `owner/name` list; `null` discovers every repository that depends on `@eemelinen/harness` |
| `hostProjects`                                                                      | `/home/eemeli/projects`               | Mounted read-only for traces (also `HOST_PROJECTS` in `.env`)                             |
| `pollMinutes`                                                                       | 10                                    |                                                                                           |
| `triage.model`, `effort`, `maxTurns`, `maxBudgetUsd`, `wallClockMin`, `maxPerCycle` | `claude-opus-5-5`, high, 40, 2, 20, 3 | The triage session                                                                        |
| `build.maxPerDay`                                                                   | 4                                     | Harness loop runs per 24 hours                                                            |

## Development

This repository uses the harness itself: see [AGENTS.md](AGENTS.md). `./init.sh` installs and runs
`pnpm check` (typecheck, Prettier, the secrets check, `harness check`, the Vitest suite).
