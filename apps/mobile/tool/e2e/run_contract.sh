#!/usr/bin/env bash
#
# Start the PhotoX e2e stack with core published on loopback, wait for health,
# then run the live upload-session contract suite against it.
#
# Usage:
#   tool/e2e/run_contract.sh
#   E2E_CORE_PORT=3917 tool/e2e/run_contract.sh
#   E2E_BUILD=1 tool/e2e/run_contract.sh      # rebuild core/worker/web images
#   E2E_KEEP=1 tool/e2e/run_contract.sh       # leave the stack running
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ARTIFACTS_DIR="$SCRIPT_DIR/artifacts"
PROJECT_NAME="photox-mobile-e2e"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed or not on PATH" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "error: the docker compose plugin is not available" >&2
  exit 1
fi
if ! command -v flutter >/dev/null 2>&1; then
  echo "error: flutter is not installed or not on PATH" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required to wait for core health" >&2
  exit 1
fi

for compose_file in \
  "$REPO_DIR/docker-compose.yml" \
  "$REPO_DIR/docker-compose.e2e.yml" \
  "$SCRIPT_DIR/docker-compose.mobile.yml"; do
  if [[ ! -f "$compose_file" ]]; then
    echo "error: compose file not found: $compose_file" >&2
    exit 1
  fi
done

COMPOSE=(
  docker compose
  -p "$PROJECT_NAME"
  -f "$REPO_DIR/docker-compose.yml"
  -f "$REPO_DIR/docker-compose.e2e.yml"
  -f "$SCRIPT_DIR/docker-compose.mobile.yml"
)

pick_port() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
  elif command -v node >/dev/null 2>&1; then
    node -e 'const net = require("net"); const s = net.createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });'
  else
    echo "error: python3 or node is required to pick a free port" >&2
    return 1
  fi
}

if [[ -z "${E2E_CORE_PORT:-}" ]]; then
  E2E_CORE_PORT="$(pick_port)"
fi
export E2E_CORE_PORT
BASE_URL="http://127.0.0.1:${E2E_CORE_PORT}"

cleanup() {
  local status=$?
  if (( status != 0 )); then
    mkdir -p "$ARTIFACTS_DIR"
    echo "==> Contract run failed (exit $status); core logs: $ARTIFACTS_DIR/core.log" >&2
    "${COMPOSE[@]}" logs --no-color core >"$ARTIFACTS_DIR/core.log" 2>&1 || true
    tail -n 80 "$ARTIFACTS_DIR/core.log" >&2 || true
  fi
  if [[ "${E2E_KEEP:-0}" == "1" ]]; then
    echo "==> E2E_KEEP=1: leaving the stack running at $BASE_URL" >&2
  else
    echo "==> Tearing down the e2e stack (volumes included)" >&2
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

echo "==> Starting PhotoX e2e stack (project: $PROJECT_NAME)"
echo "    core: $BASE_URL"
UP_ARGS=(up -d)
if [[ "${E2E_BUILD:-0}" == "1" ]]; then
  UP_ARGS+=(--build)
fi
(cd "$REPO_DIR" && "${COMPOSE[@]}" "${UP_ARGS[@]}")

echo "==> Waiting up to 180s for $BASE_URL/health"
deadline=$((SECONDS + 180))
until curl -fsS "$BASE_URL/health" >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "error: core did not become healthy within 180s" >&2
    exit 1
  fi
  sleep 2
done
echo "==> Core is healthy"

export PHOTOX_E2E_BASE_URL="$BASE_URL"
echo "==> Running flutter test test/contract"
(cd "$ROOT_DIR" && flutter test test/contract)
