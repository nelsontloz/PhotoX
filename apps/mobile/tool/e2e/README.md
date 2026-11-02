# Mobile e2e harness

Helpers for running the Flutter app and its live HTTP contract suite against
the PhotoX core in `apps/core`, using this repo's root compose files.

The mobile app has no server of its own: every check here starts the PhotoX
Compose e2e stack and points the app/test at its `core` service.

## Prerequisites

- Docker Engine/Desktop with the Compose v2 plugin (`docker compose version`).
- `curl`.
- `python3` or `node` — used once to pick a free loopback port when
  `E2E_CORE_PORT` is unset.
- Flutter 3.47+ (`flutter` on `PATH`) for the app and contract suite.
- For device work: an Android device/emulator with `adb`, or a booted iOS
  Simulator / physical iPhone with Xcode.

## Stack topology

`tool/e2e/stack_up.sh` and `run_contract.sh` merge three Compose files:

| File | Purpose |
| --- | --- |
| `docker-compose.yml` (repo root) | infra base: postgres, redis, floci S3 |
| `docker-compose.e2e.yml` (repo root) | e2e stack: core, worker-service, web; infra ports unpublished |
| `tool/e2e/docker-compose.mobile.yml` | mobile override: publishes core on loopback |

Services: `core` (NestJS API), `worker-service` (BullMQ workers),
`web` (admin UI, host `127.0.0.1:${E2E_WEB_PORT:-5273}`), `postgres`, `redis`,
`floci`. Only `core` (mobile override) and `web` are reachable from the host;
infra ports stay inside the Compose network. The project name is fixed to
`photox-mobile-e2e` so every helper sees the same stack.

The mobile override publishes:

```text
127.0.0.1:${E2E_CORE_PORT:-3917} -> core:3000
```

The core image is `photox-e2e-core:latest`; `E2E_BUILD=1` rebuilds the e2e
images before starting.

## Commands

Run from the repo root:

```bash
tool/e2e/stack_up.sh                 # start + wait for health
tool/e2e/run_contract.sh             # start, run test/contract, tear down
tool/e2e/stack_down.sh               # stop + remove volumes (idempotent)

E2E_CORE_PORT=3917 tool/e2e/stack_up.sh
E2E_BUILD=1 tool/e2e/run_contract.sh
E2E_KEEP=1 tool/e2e/run_contract.sh  # leave the stack up after the suite

# Contract suite against an already-running core:
PHOTOX_E2E_BASE_URL=http://127.0.0.1:3917 flutter test test/contract
```

`run_contract.sh` waits up to 180 seconds for `GET /health`, exports
`PHOTOX_E2E_BASE_URL`, runs `flutter test test/contract`, and always tears the
stack down (`down -v`) unless `E2E_KEEP=1`. On failure it prints the tail of
the core log and writes the full log to `tool/e2e/artifacts/core.log`.

Seed media for a running app:

```bash
tool/e2e/seed_android.sh                     # generated 1x1 PNG
tool/e2e/seed_android.sh photo1.jpg photo2.png
tool/e2e/seed_ios.sh [image ...]
```

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `E2E_CORE_PORT` | auto-picked free port (compose default `3917`) | Host loopback port for core |
| `E2E_WEB_PORT` | `5273` | Host loopback port for the e2e web UI |
| `E2E_BUILD` | unset | `1` adds `--build` to `docker compose up` |
| `E2E_KEEP` | unset | `1` leaves the stack running after `run_contract.sh` |
| `PHOTOX_E2E_BASE_URL` | unset | Base URL read by the contract test; without it the suite skips |
| `PHOTOX_API_URL` | `http://localhost:3000` | App build-time core URL (`--dart-define`) |
| `ANDROID_SERIAL` | adb default | Target one of several connected Android devices |

## Contract test behaviour

`test/contract/upload_session_contract_test.dart` is opt-in and asserts against
a live core:

- registers a fresh random user via raw Dio, then signs in through the real
  `AuthManager` login path;
- creates an 8 MiB-part upload session for a generated 1x1 PNG and checks the
  `201` contract;
- uploads part 0, reads session status, completes it, completes it again
  (deduplicated), checks the dedup `exists` hit, and confirms a second
  single-file upload of the same bytes returns `409` with
  `existingAssetId`/`existingFileId`;
- forces a refresh-token rotation and confirms a subsequent authenticated call
  still succeeds.

Without `PHOTOX_E2E_BASE_URL` the whole group is skipped with an explanatory
message, so a plain `flutter test` stays green and never touches the network.
The suite needs a healthy stack; run it through `run_contract.sh` or start the
stack first.

## Artifacts

- `tool/e2e/artifacts/core.log` — core container log written only when
  `run_contract.sh` fails. The directory is gitignored.
- `tool/e2e/.tmp/` — generated seed PNGs. Gitignored.
- Compose volumes (`pgdata`, `storage-data`, floci data) are deleted by
  `stack_down.sh` and by `run_contract.sh` unless `E2E_KEEP=1`.
- Flutter test reports/screenshots, if requested with `--reporter`, go wherever
  that reporter writes them.

## Device/emulator notes

- The override binds core to host loopback only. Android emulators can use
  `http://10.0.2.2:<port>`; iOS Simulators use `http://127.0.0.1:<port>`.
  Physical Android devices can use `adb reverse tcp:<port> tcp:<port>` and then
  target `http://127.0.0.1:<port>`. A physical iPhone needs a core URL reachable
  over the LAN/tunnel.
- Background execution cannot be validated on a simulator/emulator. See
  [device_background.md](device_background.md).
- Seeded media is indexed asynchronously; the app's next sync pass (usually an
  app open/resume) discovers it.

## Limitations

- Background sync is best-effort and device-only; app-open/resume is the
  guaranteed path. Force-quit stops background work until the app is reopened.
- No upload notifications and no Android foreground service yet, so long
  uploads only run while the OS grants a background window or the app is open.
- iOS limited-library selection only exposes the user-picked assets.
- The e2e stack is not production: open registration and permissive rate
  limits are enabled for test users, and storage is container-local.
- The core service has no host port in the base e2e stack; without
  `docker-compose.mobile.yml` the host cannot reach it.
