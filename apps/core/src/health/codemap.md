# apps/core/src/health/

## Responsibility

Liveness/readiness endpoint for the core process, unversioned at `GET /health`, reporting Postgres and Redis connectivity plus process uptime.

## Design

- `HealthController` — `@Controller('health')`, single `@Get() check()`; no guards, no Swagger tag. `/health` is an exact open route in `JwtAuthGuard` (`open-routes.ts`), so it is reachable without a token.
- `HealthService` injects `DataSource` directly (not `@InjectRepository` — avoids `forFeature` coupling, per AGENTS.md) and returns:
  `{ status: 'ok' | 'degraded', service: 'core', uptime: process.uptime(), timestamp: ISO, checks: { database: { status, latencyMs }, redis: { status, latencyMs } } }`.
- Database check: `dataSource.query('SELECT 1')`, latency measured with `Date.now()`.
- Redis check: a **short-lived `ioredis` client per call** (`REDIS_HOST`/`REDIS_PORT` from `loadEnv()`, `maxRetriesPerRequest: 1`, `enableReadyCheck: true`), `PING`, then `disconnect()` in `finally`. ponytail ceiling: one connection per health request — fine at personal scale; swap for a shared client if polling ever matters.
- Failures are captured per check and never thrown: HTTP stays **200** and the top-level `status` flips to `degraded`. That behaviour is deliberate per AGENTS.md.
- No shared-types response interface: `HealthService.check()`'s returned object literal is the de-facto contract (the controller has no return annotation).

## Flow

`GET /health` → open route (no Bearer needed) → core controller → service runs the DB query then the Redis ping → JSON status. Docker/compose and tooling use this as the liveness signal.

## Integration

- Redis is the same instance BullMQ uses; a down Redis shows as `degraded` while the publisher still swallows enqueue failures.
- Env: `REDIS_HOST`, `REDIS_PORT` from `@photox/shared-config`; Postgres connection comes from the shared TypeORM DataSource.
- Core's port :3000 is not published, so this endpoint is internal-only in compose.
