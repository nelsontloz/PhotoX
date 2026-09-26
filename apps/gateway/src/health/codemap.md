# apps/gateway/src/health/

## Responsibility
- `HealthController` + `HealthModule` + `HealthService`: unauthenticated `GET /health` liveness/readiness endpoint that reports whether core is reachable.
- `GET /health` is the only route the gateway answers itself besides `/api/*` proxying; it never touches the proxy or DB.

## Design
- `@Controller('health')` with a single `@Get() check()`; unversioned and exactly matched, which is what puts it in the guard's open table (`path === '/health'`).
- `HealthModule` is controller + provider only; no imports, no DB/queue coupling.
- `HealthService` reads `CORE_BASE_URL` from `loadEnv()` once at construction, then:
  - `fetch(`${coreBaseUrl}/health`, { signal: AbortSignal.timeout(3000) })` — a 3s budget keeps the probe snappy and never hangs on a dead core.
  - per-check `{ status: 'up'|'down', latencyMs }` recorded under `checks.core` (`res.ok` decides up/down; a throw still records elapsed latency).
- Result shape:
  - `status: 'ok'` only when every check is up, otherwise `'degraded'`.
  - `service: 'gateway'`, `uptime`, ISO `timestamp`, `checks`.
- Always HTTP 200 — degradation is a body field, not a status code; the controller returns a plain object so Nest renders 200 regardless of the `status` value.

## Flow
- Request → `GatewayAuthGuard` open-route check passes → controller → `check()` → upstream `fetch` → JSON.
- Unit tests stub global `fetch`:
  - `{ ok: true }` → `status: 'ok'`, `checks.core.status: 'up'`.
  - rejected promise → `status: 'degraded'`, `checks.core.status: 'down'`.
- A fetch timeout is just a rejection → core marked `down`; the gateway still answers 200.

## Integration
- Upstream: core `:3000/health` over plain `fetch`, direct — not through the proxy.
- Downstream: compose healthchecks / operators hit `curl localhost:3001/health`; the `checks` object leaves room for more dependencies without changing clients.
