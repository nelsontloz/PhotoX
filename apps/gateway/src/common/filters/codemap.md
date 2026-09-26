# apps/gateway/src/common/filters/

## Responsibility
- `HttpExceptionFilter` (`http-exception.filter.ts`) — the single global exception filter, registered with `app.useGlobalFilters(new HttpExceptionFilter())` in `main.ts`.
- Normalizes every thrown error into a JSON body plus status code; it is the last step before a failed request leaves the process.

## Design
- `@Catch()` with no argument → catches everything, not just `HttpException`.
- `HttpException` → use `exception.getStatus()` and `exception.getResponse()` verbatim, so Nest's `{ statusCode, message, error }` shape and guard responses pass through unchanged.
- Anything else → 500 with `{ statusCode: 500, message: 'Internal server error' }`; the real error is never leaked to clients.
- Status ≥ 500 is logged via Nest `Logger` (`HttpExceptionFilter`, prefix `[ExceptionFilter]`) with the serialized body; 4xx is silent.
- Deliberate duplicate of the core filter (`ponytail:` comment) — no cross-app imports.

## Flow
- Exception thrown in guard/controller/service → Nest dispatches to this filter → `response.status(status).json(body)`.
- Concretely:
  - missing/invalid/expired token → 401 from `GatewayAuthGuard`.
  - non-admin on `/api/v1/admin/*` → 403 `Admin only`.
  - core unreachable → `BadGatewayException` → 502 `Core unreachable`.
  - unexpected bugs → 500 `Internal server error` (logged).

## Integration
- Runs after the global `ValidationPipe` and `GatewayAuthGuard` in the request pipeline; the proxy's `BadGatewayException` is the main non-guard producer.
- Wire-compatible with `apps/core`'s filter so clients see one error contract across both hops.
- No spec file: behavior is exercised indirectly through the guard and proxy specs.
