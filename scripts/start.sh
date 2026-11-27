#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

printf '\n Starting Antigravity Chrome Bridge Server v2.0...\n\n'

if [ ! -d "node_modules" ]; then
  printf ' [*] node_modules not found. Running pnpm install...\n\n'
  pnpm install
fi

pnpm build
pnpm start
