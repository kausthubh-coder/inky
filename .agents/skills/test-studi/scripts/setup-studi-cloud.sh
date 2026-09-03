#!/usr/bin/env bash
set -euo pipefail

bun install
if [[ -n "${STUDI_QA_CODEX_AUTH:-}" ]]; then
  node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --import >/dev/null
fi
bun run build
