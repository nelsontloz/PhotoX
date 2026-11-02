#!/usr/bin/env bash
#
# Seed the booted iOS Simulator photo library. With no arguments a tiny valid
# PNG is generated under tool/e2e/.tmp/.
#
# Usage:
#   tool/e2e/seed_ios.sh [image ...]
#
# Requires Xcode command-line tools (xcrun + simctl) and a booted simulator.
# For a physical device use Xcode's Devices window or drag files into Photos.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$SCRIPT_DIR/.tmp"
PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found." >&2
  echo "       Install Xcode and run 'xcode-select --install' (or select Xcode with xcode-select)." >&2
  exit 1
fi

if ! xcrun simctl help >/dev/null 2>&1; then
  echo "error: xcrun simctl is unavailable. Install/select a full Xcode, not only Command Line Tools." >&2
  exit 1
fi

if ! xcrun simctl list devices booted | grep -q '(Booted)'; then
  echo "error: no booted iOS Simulator found." >&2
  echo "       Open Simulator or run 'xcrun simctl boot \"iPhone 15\"' first." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  mkdir -p "$TMP_DIR"
  generated="$TMP_DIR/seed-$$.png"
  # GNU base64 uses --decode; macOS /usr/bin/base64 uses -D.
  if ! printf '%s' "$PNG_BASE64" | base64 --decode >"$generated" 2>/dev/null; then
    printf '%s' "$PNG_BASE64" | base64 -D >"$generated"
  fi
  set -- "$generated"
  echo "==> Generated $generated"
fi

for src in "$@"; do
  if [[ ! -f "$src" ]]; then
    echo "error: not a file: $src" >&2
    exit 1
  fi
  xcrun simctl addmedia booted "$src"
  echo "==> Seeded $(basename "$src")"
done

echo "==> iOS simulator gallery seed complete"
