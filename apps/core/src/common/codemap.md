# apps/core/src/common/

## Responsibility

Process-wide HTTP plumbing with no domain knowledge: the catch-all exception filter and the request-id middleware. There is no `CommonModule` — both are wired directly in `src/main.ts`.

## Design

Contents:
- `filters/http-exception.filter.ts` — `HttpExceptionFilter`, `@Catch()` everything.
- `middleware/request-id.middleware.ts` — exported plain function (not an `@Injectable` class), used via `app.use(...)`.

Deliberate scope limit: no interceptors, no logging module, no pagination helpers, no base DTOs. The `ValidationPipe` is constructed inline in `main.ts`. Add a shared utility here only when a second caller actually appears (ponytail).

Both pieces are stateless and dependency-free (express types + `node:crypto` only), which is why they need no Nest module wiring.

## Flow

Every request: `requestIdMiddleware` runs first → global `GatewayIdentityGuard` → `ValidationPipe` → controller → service. Every thrown error unwinds to `HttpExceptionFilter`, which serializes the status/body for the gateway to forward.

## Integration

- `main.ts` registers middleware before pipes/filter; integration tests (`test/integration/helpers.ts`) apply the same `HttpExceptionFilter` so test error shapes match production.
- Mirrors the gateway's `common/` conventions (identical request-id middleware; same error passthrough) so proxied responses look uniform; core deliberately adds no CORS.
- Filter output is what the gateway forwards verbatim; only an unreachable core becomes a gateway 502.
