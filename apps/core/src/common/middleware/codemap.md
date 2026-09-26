# apps/core/src/common/middleware/

## Responsibility

Request-correlation middleware: ensures every core request carries an `x-request-id`.

## Design

`requestIdMiddleware(req, _res, next)`:
- Takes the inbound `x-request-id` header when present, otherwise `randomUUID()` from `node:crypto`.
- Writes the value back onto `req.headers['x-request-id']`, so guards/controllers/services (and anything reading the request) see one stable id.
- Never writes a response header and never logs — pure request-side propagation.

Exported as a plain Express handler (no `@Injectable`), registered with `app.use(requestIdMiddleware)` in `src/main.ts`, so it stays outside Nest DI by design. Header-only mutation means it works for JSON, multipart/streamed uploads, and downloads alike.

## Flow

Gateway request (the gateway's identical middleware already set/generated the id) → core middleware preserves it → downstream code reads `req.headers['x-request-id']`. An id generated at core indicates the caller bypassed the gateway (or a server-to-server call).

## Integration

- The gateway runs the same middleware first (`apps/gateway/src/common/middleware/request-id.middleware.ts`) and `proxy.service` forwards `x-request-id` on the outbound leg; the gateway proxy spec pins that header.
- Intentionally duplicated per app — no cross-app runtime imports.
- Because no response header is set, clients don't receive the id back; it exists for server-side log correlation only.
- No spec in this folder: propagation is covered from the gateway side by `apps/gateway/src/proxy/proxy.service.spec.ts`.
