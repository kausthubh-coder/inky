#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "setup-studi-cloud.sh requires an Ubuntu/Debian container with apt-get." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  xvfb xauth dbus-x11 \
  libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 \
  libgbm1 libgtk-3-0 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
  libxfixes3 libxkbcommon0 libxrandr2

if [[ -n "${CLERK_SECRET_KEY:-}" ]]; then
  node <<'NODE'
const { chmodSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const path = ".env.local";
const current = existsSync(path) ? readFileSync(path, "utf8") : "";
const lines = current.split(/\r?\n/).filter(line => line && !line.startsWith("CLERK_SECRET_KEY="));
lines.push(`CLERK_SECRET_KEY=${process.env.CLERK_SECRET_KEY}`);
writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
chmodSync(path, 0o600);
NODE
fi

bun install
bunx playwright install --with-deps chromium
if [[ -n "${STUDI_QA_CODEX_AUTH:-}" ]]; then
  node .agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs --import >/dev/null
fi
bun run build
bun run build:lms
