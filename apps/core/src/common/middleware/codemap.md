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

Inbound request (a caller, proxy, or test may already set `x-request-id`) → core middleware preserves it → downstream code reads `req.headers['x-request-id']`. An id generated at core means the caller sent none.

## Integration

- It is the only request-id middleware in the repo; an upstream proxy or test caller that sets `x-request-id` has it preserved.
- Because no response header is set, clients don't receive the id back; it exists for server-side log correlation only.
- No spec in this folder.
