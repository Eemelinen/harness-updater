#!/usr/bin/env bash
# Standard startup and verification path (AGENTS.md → Clock-in).
#   ./init.sh          install + wiring check + L1 baseline (`pnpm check`)
#   FAST=1 ./init.sh   skip the baseline (tooling and wiring only)
# The service itself runs in Docker: README.md → Running it.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$1"; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

step "Working directory: $PWD"

step "Tooling"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed; install Node 22 (see .nvmrc)." >&2
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is missing; run: corepack enable" >&2
  exit 1
fi
echo "node $(node -v | tr -d v) · pnpm $(pnpm -v)"
if docker info >/dev/null 2>&1; then
  echo "docker: running"
else
  warn "Docker is not running — the service cannot be built or started (pnpm check does not need it)"
fi

step "Installing dependencies"
pnpm install --frozen-lockfile

step "Harness wiring"
pnpm harness:doctor

if [ "${FAST:-0}" = "1" ]; then
  step "FAST=1 — skipping baseline verification"
else
  step "Baseline verification (L1): pnpm check"
  pnpm check
fi
