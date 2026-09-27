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

Every request: `requestIdMiddleware` runs first → global `JwtAuthGuard` → `ValidationPipe` → controller → service. Every thrown error unwinds to `HttpExceptionFilter`, which serializes the final status/body.

## Integration

- `main.ts` registers middleware before pipes/filter; integration tests (`test/integration/helpers.ts`) apply the same `HttpExceptionFilter` so test error shapes match production.
- Same request-id and error-shape conventions as the rest of the workspace; core deliberately adds no CORS.
- Filter output is the final error shape clients see; 4xx bodies pass through verbatim, unexpected errors become the generic 500 body.
