#!/usr/bin/env bash
# E2E stack + BDD suite runner. playwright.config.ts splits the features into two projects:
# `setup` runs first, serially, on the fresh database — 01-bootstrap must register the first
# account (it becomes admin) before anything else registers, and 04-faces /
# 05-semantic/semantic-upload.feature mutate global state (active detector, reprocess-all,
# recluster for every user). Inside `setup` the numbered folders still run in alphabetical path
# order — do not rename or reorder them. The `suite` project (every other feature) depends on
# `setup` and runs with the worker pool.
# Usage: pnpm test:e2e   (from the repo root)
#   E2E_BUILD=1      rebuild images before starting the stack
#   E2E_KEEP=1       leave the stack running after the tests (debugging)
#   --workers=N      playwright's native worker count (parallel `suite` project)
# Each run uses a unique compose project and an OS-assigned web port; the stack is stopped and
# removed when the script exits. Artifact dirs (.features-gen, test-results, playwright-report)
# are fixed, so parallel runs share (and overwrite) each other's artifacts.
set -euo pipefail
E2E_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
cd "$ROOT"

pick_port() {
  node -e "const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close() })"
}

E2E_PROJECT="${E2E_PROJECT:-photox-e2e-$$-$RANDOM}"
E2E_WEB_PORT="${E2E_WEB_PORT:-$(pick_port)}"
export E2E_WEB_PORT

COMPOSE=(docker compose -p "$E2E_PROJECT" -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.e2e.yml")

cleanup() {
  if [ "${E2E_KEEP:-0}" = "1" ]; then
    echo "E2E_KEEP=1: leaving the stack running (project: $E2E_PROJECT, web: http://localhost:$E2E_WEB_PORT)"
    return 0
  fi
  "${COMPOSE[@]}" down -v --remove-orphans
  rm -rf "$E2E_DIR/.features-gen" "$E2E_DIR/test-results"
  if [ -d "$E2E_DIR/playwright-report" ]; then
    echo "Playwright report: e2e/playwright-report (view: pnpm --filter @photox/e2e exec playwright show-report playwright-report)"
  fi
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
