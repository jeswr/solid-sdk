#!/usr/bin/env bash
# Run the Playwright suite on randomized free ports. Multiple agents/projects on
# one machine each run their own CSS + app, so fixed ports (3000/3200) collide —
# every run picks its own pair unless IT_CSS_PORT / IT_APP_PORT are preset.
set -euo pipefail

pick_free_port() {
  local base=$1 range=$2 port
  for _ in $(seq 1 20); do
    port=$((base + RANDOM % range))
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$port"
      return 0
    fi
  done
  echo "could not find a free port near $base" >&2
  return 1
}

# Clear any stale Next server of OURS from a previous run (scoped to this repo's
# node_modules path; other projects are untouched). We serve a production build
# (`next start`) for stability — see playwright.config.ts — but also clear a stale
# `next dev` in case one is lingering from an older config.
pkill -f "$(pwd)/node_modules/.bin/next start" 2>/dev/null || true
pkill -f "$(pwd)/node_modules/.bin/next dev" 2>/dev/null || true
sleep 1

export IT_CSS_PORT="${IT_CSS_PORT:-$(pick_free_port 3300 600)}"
export IT_APP_PORT="${IT_APP_PORT:-$(pick_free_port 4100 800)}"
export IT_CSS_BASE="${IT_CSS_BASE:-http://localhost:${IT_CSS_PORT}}"

echo "e2e: CSS on :${IT_CSS_PORT}, app on :${IT_APP_PORT}"
exec npx playwright test "$@"
