#!/usr/bin/env bash
# Mobile (Flutter) e2e runner. Boots the real stack in containers, boots an
# Android emulator on the host (a container cannot run one on macOS), and drives
# apps/mobile/integration_test against it over real HTTP.
#
# Opt-in: `pnpm mobile:e2e`, never part of `pnpm verify` — it needs an AVD.
#
#   MOBILE_E2E_BUILD=1     rebuild the compose images first
#   MOBILE_E2E_KEEP=1      leave the stack running
#   MOBILE_E2E_HEADLESS=1  boot the emulator without a window
#   MOBILE_E2E_AVD=<id>    AVD to boot (default: photox)
#   MOBILE_E2E_STOP_EMULATOR=1  kill the emulator on exit instead of leaving it
#   ADB=<path>             adb binary (default: $ANDROID_HOME, then PATH, then
#                          `flutter doctor -v`, because adb is often off PATH)
#
# The emulator is left running between runs and reused (its boot is the slow
# part of a cold run).
#
# The two test files run in separate app processes and each starts from cleared
# app data (`flutter test` reinstalls the APK without the app's state):
# auth_flow drives the first-launch and session flows, auth_protocol checks the
# token contract over HTTP. `adb shell pm clear` runs once, before the first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOBILE_DIR="$ROOT/apps/mobile"
PACKAGE="com.photox.photox_mobile"
LOG_DIR="${TMPDIR:-/tmp}/photox-mobile-e2e"
AVD="${MOBILE_E2E_AVD:-photox}"
LOCK_DIR="${TMPDIR:-/tmp}/photox-mobile-e2e.lock"
STARTED_EMU=0
SERIAL=""
COMPOSE=()

die() {
  echo "ERROR: $*" >&2
  exit 1
}

mkdir -p "$LOG_DIR"

# --- one run at a time: the AVD and `adb reverse` are process-wide resources ---
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  die "another mobile e2e run holds the lock ($LOCK_DIR); remove it if that run crashed"
fi

pick_port() {
  node -e "const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close() })"
}

# --- adb / emulator discovery ---
if [ -z "${ADB:-}" ]; then
  if command -v adb >/dev/null 2>&1; then
    ADB="$(command -v adb)"
  else
    SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
    if [ -z "$SDK" ]; then
      SDK="$(flutter doctor -v 2>/dev/null | sed -n 's/.*Android SDK at //p' | head -1)"
    fi
    [ -n "$SDK" ] && ADB="$SDK/platform-tools/adb"
  fi
fi
[ -n "${ADB:-}" ] && [ -x "$ADB" ] ||
  die "adb not found; set ADB=/path/to/adb (see apps/mobile/AGENTS.md)"
EMULATOR="$(cd "$(dirname "$ADB")/.." && pwd)/emulator/emulator"

E2E_PROJECT="${MOBILE_E2E_PROJECT:-photox-mobile-e2e-$$-$RANDOM}"
MOBILE_E2E_CORE_PORT="${MOBILE_E2E_CORE_PORT:-$(pick_port)}"
export MOBILE_E2E_CORE_PORT

# The emulator's 10.0.2.2 is the host loopback through the emulator's own NAT,
# so no adb reverse and no fixed device-side port: the app is pointed straight at
# the port this run published. The setup screen names 10.0.2.2 for exactly this.
APP_URL="http://10.0.2.2:${MOBILE_E2E_CORE_PORT}"
COMPOSE=(docker compose -p "$E2E_PROJECT" -f "$ROOT/docker-compose.yml" \
  -f "$ROOT/docker-compose.e2e.yml" -f "$ROOT/docker-compose.mobile-e2e.yml")

cleanup() {
  local status=$?
  rmdir "$LOCK_DIR" 2>/dev/null || true
  if [ "${MOBILE_E2E_KEEP:-0}" = "1" ]; then
    echo "MOBILE_E2E_KEEP=1: leaving the stack and the emulator running."
    echo "  core:      http://127.0.0.1:${MOBILE_E2E_CORE_PORT} (app uses ${APP_URL})"
    if [ -n "$SERIAL" ]; then
      echo "  launch:    $ADB -s $SERIAL shell am start -n ${PACKAGE}/.MainActivity"
    fi
    echo "  stop:      docker compose -p $E2E_PROJECT ... down -v"
    return 0
  fi
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  if [ "${MOBILE_E2E_STOP_EMULATOR:-0}" = "1" ] && [ "$STARTED_EMU" = "1" ] && [ -n "$SERIAL" ]; then
    "$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1 || true
  elif [ "$STARTED_EMU" = "1" ] && [ -n "$SERIAL" ]; then
    echo "Emulator $SERIAL left running; the next run reuses it."
  fi
  exit "$status"
}
trap cleanup EXIT

# --- 1. server stack ---
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
if [ "${MOBILE_E2E_BUILD:-0}" = "1" ]; then
  "${COMPOSE[@]}" up -d --build
else
  "${COMPOSE[@]}" up -d
fi

echo "Waiting for core on http://127.0.0.1:${MOBILE_E2E_CORE_PORT}/health..."
for i in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${MOBILE_E2E_CORE_PORT}/health" >/dev/null 2>&1; then break; fi
  [ "$i" -eq 120 ] && {
    "${COMPOSE[@]}" logs --tail=40
    die "core not ready after 120s"
  }
  sleep 1
done

# --- 2. test user: the app's login screen has no register form ---
E2E_EMAIL="mobile-e2e-$(date +%s)-$$@photox.test"
E2E_PASSWORD="password123"
echo "Registering $E2E_EMAIL..."
REGISTER_STATUS="$(curl -s -o "$LOG_DIR/register.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASSWORD\",\"displayName\":\"Mobile E2E\"}" \
  "http://127.0.0.1:${MOBILE_E2E_CORE_PORT}/api/v1/auth/register")"
[ "$REGISTER_STATUS" = "201" ] || [ "$REGISTER_STATUS" = "200" ] ||
  die "register failed ($REGISTER_STATUS): $(cat "$LOG_DIR/register.json")"

# --- 3. emulator ---
SERIAL="$("$ADB" devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1; exit }')"
if [ -n "$SERIAL" ]; then
  echo "Reusing the running emulator $SERIAL."
else
  [ -x "$EMULATOR" ] || die "emulator binary not found at $EMULATOR"
  EMU_ARGS=(-avd "$AVD" -no-audio -no-snapshot)
  EMU_MODE="windowed"
  if [ "${MOBILE_E2E_HEADLESS:-0}" = "1" ]; then
    EMU_ARGS+=(-no-window -no-boot-anim -gpu swiftshader_indirect)
    EMU_MODE="headless"
  else
    EMU_ARGS+=(-gpu auto)
  fi
  echo "Booting AVD $AVD ($EMU_MODE)..."
  "$EMULATOR" "${EMU_ARGS[@]}" >"$LOG_DIR/emulator.log" 2>&1 &
  STARTED_EMU=1
  for i in $(seq 1 90); do
    SERIAL="$("$ADB" devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1; exit }')"
    [ -n "$SERIAL" ] && break
    sleep 2
  done
  [ -n "$SERIAL" ] || {
    tail -20 "$LOG_DIR/emulator.log" >&2
    die "emulator $AVD did not appear (see $LOG_DIR/emulator.log)"
  }
fi

echo "Waiting for $SERIAL to finish booting..."
for i in $(seq 1 180); do
  if [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then break; fi
  [ "$i" -eq 180 ] && die "emulator did not finish booting after 180s"
  sleep 2
done

# --- 4. app: build, install, clear, grant ---
# Installed once up front so `pm clear`/`pm grant` have a package to act on; the
# grant stops the OS photo-permission dialog from sitting over the first screen.
echo "Building the debug APK..."
(cd "$MOBILE_DIR" && flutter build apk --debug) >"$LOG_DIR/build.log" 2>&1 ||
  {
    tail -40 "$LOG_DIR/build.log" >&2
    die "flutter build apk failed (see $LOG_DIR/build.log)"
  }
"$ADB" -s "$SERIAL" install -r "$MOBILE_DIR/build/app/outputs/flutter-apk/app-debug.apk" \
  >"$LOG_DIR/install.log" 2>&1 || {
  tail -20 "$LOG_DIR/install.log" >&2
  die "adb install failed"
}
"$ADB" -s "$SERIAL" shell pm clear "$PACKAGE" >/dev/null
for perm in READ_MEDIA_IMAGES READ_MEDIA_VIDEO READ_MEDIA_VISUAL_USER_SELECTED ACCESS_MEDIA_LOCATION; do
  "$ADB" -s "$SERIAL" shell pm grant "$PACKAGE" "android.permission.$perm" >/dev/null 2>&1 || true
done

# --- 5. the suite ---
run_test() {
  echo
  echo "=== $1 ==="
  (cd "$MOBILE_DIR" && flutter test "integration_test/$1" -d "$SERIAL" \
    --dart-define=PHOTOX_E2E_API_URL="$APP_URL" \
    --dart-define=PHOTOX_E2E_EMAIL="$E2E_EMAIL" \
    --dart-define=PHOTOX_E2E_PASSWORD="$E2E_PASSWORD")
}

run_test auth_flow_test.dart
run_test auth_protocol_test.dart

echo
echo "Mobile e2e passed."
