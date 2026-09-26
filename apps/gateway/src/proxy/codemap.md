# apps/gateway/src/proxy/

## Responsibility
- The only route to core: `ProxyController` catches every `/api/*` request and `ProxyService` fetch-pipes it to `CORE_BASE_URL`, preserving method, status, headers, Range/206 semantics and streaming bodies.
- Files:
  - `proxy.controller.ts` — route surface.
  - `proxy.service.ts` — the fetch/pipe orchestration.
  - `proxy.utils.ts` — pure builders (URL, headers, body, timeout).
  - `proxy.module.ts` — controller + provider wiring.
  - `proxy.service.spec.ts`, `proxy.utils.spec.ts` — behavior pins.

## Design
- `@Controller()` + `@All('/api/*splat')` — Express 5 named splat (a bare `*` throws under path-to-regexp v8); the target URL is rebuilt from `req.originalUrl`, so splat params are unused.
- Pipe, never buffer:
  - request bodies for multipart/unknown types stay the live stream (`duplex: 'half'`).
  - core's response is wrapped with `Readable.fromWeb` and `pipeline`d to the Express response.
  - client disconnect (`req.on('close')`) destroys the upstream stream.
- Timeouts are per-request `AbortSignal.timeout` (no shared HTTP agent):
  - multipart → 1h (`PROXY_UPLOAD_TIMEOUT_MS`, mirrors the largest client timeout).
  - `GET` → 300s (`PROXY_DOWNLOAD_TIMEOUT_MS`, mirrors the web blob-download timeout).
  - everything else → 120s (`PROXY_DEFAULT_TIMEOUT_MS`).
- `buildTargetUrl` drops the `userId` query param while preserving the rest (`URLSearchParams` round-trip; empty query string omitted).
- `buildProxyHeaders`:
  - strips hop-by-hop headers (`host`, `connection`, `keep-alive`, proxy-auth, `te`, `trailer`, `transfer-encoding`, `upgrade`), `authorization`, `cookie`, `content-length`, plus every client-supplied `x-user-*`.
  - then attaches `x-user-id/email/role` from the verified `req.user` (open routes forward none).
  - `x-request-id` survives as a normal header.
- `buildProxyBody`:
  - JSON → re-serialize with `userId` deleted recursively (arrays included), since the parser already consumed the stream.
  - urlencoded → `URLSearchParams` re-encode minus `userId`; flat by design (arrays repeated, nested objects dropped).
  - multipart/unknown with a body → return `req` so the raw stream flows.
- `forward` copies status first, then headers minus hop-by-hop + `set-cookie` (re-appended via `getSetCookie()` for multiple cookies), which is what preserves Range/206/416 semantics; `coreRes.body === null` → `res.end()`.

## Flow
1. `/api/...` → global guard sets `req.user` (or the route is open) → `ProxyService.forward`.
2. Build URL/headers/body/timeout → `fetch` to core; network or abort failure → `BadGatewayException('Core unreachable')` → rendered as 502 by the global filter.
3. Upstream status + headers written; body streamed via `pipeline`; stream error after headers sent → `res.destroy()`, before headers → 502.

## Integration
- Reads the identity type from `apps/gateway/src/auth` and config (`CORE_BASE_URL`) from `shared-config`; no core code is imported — the wire contract is HTTP plus `x-user-*` headers.
- Core's `GatewayIdentityGuard` rebuilds `req.user` from those headers using its own open table (kept in sync with `auth/open-routes.ts`); this folder is the trust boundary where client-supplied identity is discarded.
- Gateway validates nothing per-route: DTO validation stays in core, reached through this pipe.
