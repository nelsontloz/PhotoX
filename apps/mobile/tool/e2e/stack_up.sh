#!/usr/bin/env bash
#
# Bring up the PhotoX e2e stack with core published on loopback and wait until
# it is healthy. Idempotent: re-running reuses the stack (and volumes).
#
# Usage:
#   tool/e2e/stack_up.sh
#   E2E_CORE_PORT=3917 tool/e2e/stack_up.sh
#   E2E_BUILD=1 tool/e2e/stack_up.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PHOTOX_DIR="${PHOTOX_DIR:-$ROOT_DIR/../PhotoX}"
PROJECT_NAME="photox-mobile-e2e"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "error: docker with the compose plugin is required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required to wait for core health" >&2
  exit 1
fi

for compose_file in \
  "$PHOTOX_DIR/docker-compose.yml" \
  "$PHOTOX_DIR/docker-compose.e2e.yml" \
  "$SCRIPT_DIR/docker-compose.mobile.yml"; do
  if [[ ! -f "$compose_file" ]]; then
    echo "error: compose file not found: $compose_file" >&2
    echo "       set PHOTOX_DIR to the PhotoX repository root if it is not a sibling" >&2
    exit 1
  fi
done

COMPOSE=(
  docker compose
  -p "$PROJECT_NAME"
  -f "$PHOTOX_DIR/docker-compose.yml"
  -f "$PHOTOX_DIR/docker-compose.e2e.yml"
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

UP_ARGS=(up -d)
if [[ "${E2E_BUILD:-0}" == "1" ]]; then
  UP_ARGS+=(--build)
fi

echo "==> Starting PhotoX e2e stack (project: $PROJECT_NAME)"
(cd "$ROOT_DIR" && "${COMPOSE[@]}" "${UP_ARGS[@]}")

echo "==> Waiting up to 180s for $BASE_URL/health"
deadline=$((SECONDS + 180))
until curl -fsS "$BASE_URL/health" >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "error: core did not become healthy within 180s" >&2
    echo "       inspect with: docker compose -p $PROJECT_NAME logs core" >&2
    exit 1
  fi
  sleep 2
done

echo "==> Core is healthy"
echo
echo "Contract tests:"
echo "  PHOTOX_E2E_BASE_URL=$BASE_URL flutter test test/contract"
echo "App on a device/emulator (127.0.0.1 only works on iOS simulator):"
echo "  iOS simulator:     flutter run --dart-define=PHOTOX_API_URL=http://127.0.0.1:${E2E_CORE_PORT}"
echo "  Android emulator:  flutter run --dart-define=PHOTOX_API_URL=http://10.0.2.2:${E2E_CORE_PORT}"
echo "  Physical Android:  adb reverse tcp:${E2E_CORE_PORT} tcp:${E2E_CORE_PORT}"
echo "                     flutter run --dart-define=PHOTOX_API_URL=http://127.0.0.1:${E2E_CORE_PORT}"
echo "                     (or skip adb reverse and use http://<host-lan-ip>:${E2E_CORE_PORT})"
echo "  Physical iOS:      flutter run --dart-define=PHOTOX_API_URL=http://<host-lan-ip>:${E2E_CORE_PORT}"
echo "  See tool/e2e/device_background.md for device background-execution cases."
echo "Tear down:"
echo "  tool/e2e/stack_down.sh"
