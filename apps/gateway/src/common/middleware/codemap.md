# apps/gateway/src/common/middleware/

## Responsibility
- `requestIdMiddleware` (`request-id.middleware.ts`) — a 4-line Express middleware, registered first in `main.ts` (`app.use`), that guarantees every request carries an `x-request-id`.
- It is the gateway's only middleware; everything else is guards/pipes/filters.

## Design
- Signature is plain Express (`(req, _res, next)`), not a Nest `NestMiddleware` — wired with `app.use`, so it runs before Nest routing, before the global pipe, and before the global guard.
- Behavior, in order:
  - Read `req.headers['x-request-id']` (Express lowercases incoming names) or generate `crypto.randomUUID()`.
  - Write the value back onto `req.headers['x-request-id']`.
  - `next()` — synchronous, never short-circuits.
- The write-back is the point: `ProxyService`/`buildProxyHeaders` copies the request headers verbatim, so the id reaches core with no extra plumbing.
- `_res` is intentionally unused: the gateway does not echo the id on its own responses; the id exists for upstream correlation.
- `randomUUID` comes from `node:crypto` — no extra dependency and no counter state to persist across restarts.
- Duplicate of core's middleware (`ponytail:`), no shared package yet — extract when a third copy appears.

## Flow
- Runs before routing: guard, proxy (`buildProxyHeaders` copies `x-request-id` like any other header), and core all see the same value.
- Client-supplied values are preserved, not overwritten, so web → gateway → core logs join on one id.
- No spec file; its contract is covered indirectly by the proxy spec, which asserts `x-request-id: r1` survives forwarding.

## Integration
- Consumed only by `main.ts`; no module or DI registration.
- Contract shared with core's `requestIdMiddleware`: same header name and fallback behavior, which is what makes the two services' request logs correlatable.
