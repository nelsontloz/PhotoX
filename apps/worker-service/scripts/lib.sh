#!/usr/bin/env bash
# shared by the download-*-model.sh scripts (sourced, never executed directly)
set -euo pipefail

FORCE=''
if [ "${1:-}" = '--force' ]; then FORCE=1; fi

# shared-config anchors a relative STORAGE_DIR at the workspace root (core/worker run with
# different cwds) — mirror that so custom dirs and compose/e2e (STORAGE_DIR=/data/storage) work
resolve_storage_dir() {
  local root_dir dir
  root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
  dir="${STORAGE_DIR:-data/storage}"
  case "$dir" in
    /*) ;;
    *) dir="$root_dir/$dir" ;;
  esac
  printf '%s\n' "$dir"
}

# fetch_file <url> <dest> [sha256]: curl to a temp file then atomic mv; when a sha256 is given the
# download is refused unless it matches. Returns nonzero and leaves no partial file on failure.
fetch_file() {
  local url="$1" dest="$2" sha="${3:-}"
  mkdir -p "$(dirname "$dest")"
  local tmp="${dest}.tmp.XXXXXX"
  local checker='sha256sum'
  command -v sha256sum >/dev/null 2>&1 || checker='shasum -a 256'

  if curl -fSL --retry 3 -o "$tmp" "$url" &&
    { [ -z "$sha" ] || echo "$sha  $tmp" | $checker -c - >/dev/null 2>&1; }; then
    mv -f "$tmp" "$dest"
    return 0
  fi
  rm -f "$tmp"
  return 1
}
