# apps/core/src/common/

## Responsibility

Process-wide HTTP plumbing with no domain knowledge: the catch-all exception filter. There is no `CommonModule` — it is wired directly in `src/main.ts`.

## Design

Contents:

- `filters/http-exception.filter.ts` — `HttpExceptionFilter`, `@Catch()` everything.

Deliberate scope limit: no interceptors, no logging module, no pagination helpers, no base DTOs. The `ValidationPipe` is constructed inline in `main.ts`. Add a shared utility here only when a second caller actually appears (ponytail).

The filter is stateless and dependency-free beyond `@nestjs/common` + express types, which is why it needs no Nest module wiring.

## Flow

Every request: global `JwtAuthGuard` → `ValidationPipe` → controller → service. Every thrown error unwinds to `HttpExceptionFilter`, which serializes the final status/body.

## Integration

- `main.ts` registers the global pipe and filter; integration tests (`test/integration/helpers.ts`) apply the same `HttpExceptionFilter` so test error shapes match production.
- Same error-shape conventions as the rest of the workspace; core deliberately adds no CORS.
- Filter output is the final error shape clients see; 4xx bodies pass through verbatim, unexpected errors become the generic 500 body.
