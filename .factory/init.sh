#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d node_modules ]; then
  pnpm install
fi

if [ ! -f packages/core/dist/index.js ] || [ ! -f packages/edge-worker/dist/index.js ] || [ ! -f apps/f1/dist/src/cli.js ]; then
  pnpm build
fi
