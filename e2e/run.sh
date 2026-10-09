#!/usr/bin/env bash
# E2E stack + BDD suite runner. Test files run in alphabetical path order: feature
# folders are numbered 01..09 so 01-bootstrap runs first on the fresh database
# (first registered account becomes admin) — do not rename or reorder folders.
# Usage: pnpm test:e2e   (from the repo root)
#   E2E_BUILD=1  rebuild images before starting the stack
#   E2E_KEEP=1   leave the stack running after the tests (debugging)
# Each run uses a unique compose project, an OS-assigned web port, and per-run output dirs,
# so several runs can execute in parallel; the stack is stopped and removed when the script
# exits, and only the latest run's report is kept.
set -euo pipefail
E2E_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
cd "$ROOT"

pick_port() {
  node -e "const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close() })"
}

E2E_PROJECT="${E2E_PROJECT:-photox-e2e-$$-$RANDOM}"
E2E_WEB_PORT="${E2E_WEB_PORT:-$(pick_port)}"
E2E_GEN_DIR="${E2E_GEN_DIR:-.features-gen/$E2E_PROJECT}"
E2E_OUTPUT_DIR="${E2E_OUTPUT_DIR:-test-results/$E2E_PROJECT}"
E2E_REPORT_DIR="${E2E_REPORT_DIR:-playwright-report/$E2E_PROJECT}"
export E2E_WEB_PORT E2E_GEN_DIR E2E_OUTPUT_DIR E2E_REPORT_DIR

COMPOSE=(docker compose -p "$E2E_PROJECT" -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.e2e.yml")

# Remove per-run dirs of finished runs (their containers are gone); dirs of runs that are
# still executing are kept so parallel runs never delete each other's artifacts.
prune_runs() {
  local parent="$1" keep_current="$2" dir proj
  for dir in "$parent"/*/; do
    [ -d "$dir" ] || continue
    proj="$(basename "$dir")"
    if [ "$keep_current" = "keep" ]; then
      [ "$proj" = "$E2E_PROJECT" ] && continue
      # keep only the latest report: a report newer than ours wins over ours
      [ "$dir" -nt "$parent/$E2E_PROJECT" ] && continue
    fi
    if [ -n "$(docker ps -a --filter "label=com.docker.compose.project=$proj" --format '{{.Names}}' 2>/dev/null)" ]; then continue; fi
    rm -rf "$dir"
  done
}

cleanup() {
  local had_report=0
  if [ -d "$E2E_DIR/playwright-report/$E2E_PROJECT" ]; then
    had_report=1
    echo "Playwright report: e2e/playwright-report/$E2E_PROJECT (view: pnpm --filter @photox/e2e exec playwright show-report playwright-report/$E2E_PROJECT)"
  fi
  if [ "${E2E_KEEP:-0}" = "1" ]; then
    echo "E2E_KEEP=1: leaving the stack running (project: $E2E_PROJECT, web: http://localhost:$E2E_WEB_PORT)"
    return 0
  fi
  "${COMPOSE[@]}" down -v --remove-orphans
  if [ "$had_report" = "1" ]; then
    prune_runs "$E2E_DIR/playwright-report" keep
  fi
  prune_runs "$E2E_DIR/test-results" all
  prune_runs "$E2E_DIR/.features-gen" all
}
trap cleanup EXIT

"${COMPOSE[@]}" down -v --remove-orphans
if [ "${E2E_BUILD:-0}" = "1" ]; then
  "${COMPOSE[@]}" up -d --build
else
  "${COMPOSE[@]}" up -d
fi

echo "Waiting for stack (web on http://localhost:${E2E_WEB_PORT})..."
for i in $(seq 1 120); do
  if curl -sf "http://localhost:${E2E_WEB_PORT}/health" >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 120 ]; then
    echo "ERROR: stack not ready after 120s" >&2
    "${COMPOSE[@]}" logs --tail=40
    exit 1
  fi
  sleep 1
done

cd "$E2E_DIR"
export E2E_BASE_URL="http://localhost:${E2E_WEB_PORT}"
pnpm exec bddgen
pnpm exec playwright test "$@"
