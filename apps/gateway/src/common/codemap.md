# apps/gateway/src/common/

## Responsibility
- Cross-cutting HTTP plumbing used by every route: error normalization (`filters/`) and request-id assignment (`middleware/`).
- No module file — both are wired directly in `main.ts`:
  - `app.useGlobalFilters(new HttpExceptionFilter())`
  - `app.use(requestIdMiddleware)`

## Design
- Both files are deliberate duplicates of `apps/core/src/common/*` with a `ponytail:` note: no cross-app runtime imports; extract to a shared package if a third copy appears.
- Kept tiny and dependency-free (Nest + Express types only) so they cannot drag DB/queue concerns into the stateless gateway.
- One concern per subfolder:
  - `filters/` shapes the response when something throws.
  - `middleware/` decorates the request before routing.
- Neither is provided through DI; they are global because `main.ts` registers them.

## Flow
- Inbound: `requestIdMiddleware` runs first and mutates `req.headers['x-request-id']` in place, so the proxy's header copy picks it up automatically and core receives the same id.
- On error: any exception raised after routing passes through `HttpExceptionFilter`, which serializes the final JSON response:
  - guard 401/403 → Nest `HttpException` response body passed through verbatim.
  - proxy `BadGatewayException` → 502 `Core unreachable`.
  - unexpected bugs → 500 `Internal server error` plus a server-side log.

## Integration
- `main.ts` imports both by relative path; neither is exported via a module.
- Request-id contract shared with core: same header name, client value honored, UUID generated otherwise — web → gateway → core logs join on one id.
- Error contract shared with core's filter, so clients see one shape across both hops.
