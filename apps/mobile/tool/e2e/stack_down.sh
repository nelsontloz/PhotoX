#!/usr/bin/env bash
#
# Tear down the PhotoX e2e stack and its volumes. Safe to run repeatedly, or
# when the stack was never started.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PROJECT_NAME="photox-mobile-e2e"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "error: docker with the compose plugin is required" >&2
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

echo "==> Tearing down PhotoX e2e stack (project: $PROJECT_NAME)"
(
  cd "$REPO_DIR"
  docker compose \
    -p "$PROJECT_NAME" \
    -f "$REPO_DIR/docker-compose.yml" \
    -f "$REPO_DIR/docker-compose.e2e.yml" \
    -f "$SCRIPT_DIR/docker-compose.mobile.yml" \
    down -v --remove-orphans
)
echo "==> Done"
