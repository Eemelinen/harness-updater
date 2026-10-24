#!/usr/bin/env bash
# Container start: the secrets must be there; git and gh use the token; Claude Code trusts the clones.
set -euo pipefail

: "${GH_TOKEN:?set GH_TOKEN in .env (README.md → Tokens)}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?set CLAUDE_CODE_OAUTH_TOKEN in .env (run claude setup-token on the host)}"
git config --global user.name "${GIT_AUTHOR_NAME:?set GIT_AUTHOR_NAME in .env}"
git config --global user.email "${GIT_AUTHOR_EMAIL:?set GIT_AUTHOR_EMAIL in .env}"
git config --global init.defaultBranch main
gh auth setup-git >/dev/null
node /app/docker/seed-claude.mjs

exec updater "$@"
