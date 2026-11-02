#!/usr/bin/env bash
#
# Seed the Android device/emulator gallery with images. With no arguments a
# tiny valid PNG is generated under tool/e2e/.tmp/ so the pipeline can be
# exercised end to end.
#
# Usage:
#   tool/e2e/seed_android.sh [image ...]
#
# Requires adb and exactly one attached device (use ANDROID_SERIAL when more
# than one is connected).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$SCRIPT_DIR/.tmp"
PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

if ! command -v adb >/dev/null 2>&1; then
  echo "error: adb not found." >&2
  echo "       Install the Android SDK platform-tools and add platform-tools to PATH." >&2
  exit 1
fi

if ! adb get-state >/dev/null 2>&1; then
  echo "error: no usable Android device/emulator found." >&2
  echo "       Start an emulator or connect a device, then check 'adb devices'." >&2
  echo "       If several devices are connected, set ANDROID_SERIAL=<serial>." >&2
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

adb shell mkdir -p /sdcard/Pictures >/dev/null

for src in "$@"; do
  if [[ ! -f "$src" ]]; then
    echo "error: not a file: $src" >&2
    exit 1
  fi
  name="$(basename "$src")"
  remote="/sdcard/Pictures/$name"
  adb push "$src" "$remote" >/dev/null
  # MediaStore does not watch adb pushes; ask the scanner to index the file.
  adb shell am broadcast \
    -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d "file://$remote" >/dev/null
  echo "==> Seeded $remote"
done

echo "==> Android gallery seed complete"
