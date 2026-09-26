# apps/worker-service/src/health/

## Responsibility

Liveness endpoint for the internal worker process. `GET /health` (unversioned, same style as core)
reports process uptime plus a Redis/BullMQ connectivity check, so compose/K8s can detect and restart
a worker that cannot consume jobs.

## Design

- `HealthModule` imports `QueueModule` and declares `HealthController` + `HealthService`. The import
  exists only to inject the singleton `BullMqService`; Nest module dedupe prevents double worker
  registration. `QueueModule` exports `BullMqService`.
- `HealthService.check()` probes exactly one dependency: `bullMq.isHealthy()` → ioredis
  `PING === 'PONG'`. No Postgres probe here — if Redis is down the worker consumes nothing, which is
  the actionable failure. (`apps/core/src/health` does the `SELECT 1` DB probe instead.)
- Healthy response (HTTP 200):
  `{ status: 'ok', service: 'worker-service', uptime: process.uptime(), timestamp, checks: { queue: 'ok' } }`.
- Unhealthy: `ServiceUnavailableException` → HTTP 503 with
  `{ status: 'unhealthy', service: 'worker-service', checks: { queue: 'down' | 'error' } }`.
  `isHealthy()` returns `false` on a failed ping; a thrown error from the call is caught and mapped
  to `'error'`.
- No auth, versioning, or Swagger decorators — the route is only reachable in-network.

## Flow

1. Compose/K8s probe `GET /health` on port 3004.
2. `HealthController.check()` delegates to `HealthService.check()`.
3. Service calls `BullMqService.isHealthy()` → Redis `PING`.
4. All checks `'ok'` → 200 JSON; otherwise throw 503 JSON.

## Integration

- Depends on `../queue/bullmq.service` for the shared Redis connection — health is queue-scoped by
  design; Postgres/ffmpeg/model availability are validated per-job, not here.
- Nothing else in the app calls this endpoint; gateway does not proxy worker-service.
- Sibling of `apps/core/src/health/` but with a different check key (`queue` vs core's DB check).
