# apps/web/src/pages/share/

## Responsibility

`/share/:token` — public, unauthenticated read-only viewer for a single shared asset. Renders the image or video full-screen; revoked/expired tokens show a "Share not found" state.

## Design

- `token` comes from `useParams`; an effect fetches `api.get<PublicShareResponse>('/share/' + token)` once per token with a cancellation flag. Since `api/client`'s baseURL is `/api`, this hits gateway `/api/share/:token` — part of the gateway's open table, so no JWT is needed and no `auth-store` involvement.
- A single local fetch state drives three renders: spinner, error/not-found (icon + "link may have been revoked or expired"), or media. There is no `AppShell`, sidebar, or upload UI — just a black full-screen container.
- Media URL is `/api/share/:token/stream`; photos use a plain `<img>`, videos a plain `<video controls autoPlay>` rather than `VideoPlayer` (no transcode fallback needed — the public endpoint serves the sharable file).
- 404s from the API surface as the not-found state because the API throws on missing/revoked tokens.
- `getStreamUrl` URL-encodes the token; the same token authorizes both the metadata fetch and the stream request.
- Request cancellation (`cancelled` flag) guards against state updates after token changes or unmount.
- Videos use a bare `<video controls autoPlay>`; `PublicShareResponse.asset` supplies `title`/`originalName` for the accessible title and alt text.
- Deliberately no download button, no navigation to the owner's app, and no JWT — the link is the capability.
- The UI cannot distinguish revoked vs expired shares; both collapse into the same prose message.

## Flow

Open link (possibly in a logged-out browser) → token parsed → GET `/api/share/:token` through the gateway proxy (core resolves the share, no auth) → media streamed from `/api/share/:token/stream` → done. No refresh, selection, or viewer overlay.

## Integration

`api/client` (axios `/api` base), `@photox/shared-types` (`PublicShareResponse`), `react-router-dom` (`useParams`). Share creation/revocation lives in the authenticated side: `ViewerTopBar` (create + clipboard) and `pages/shared` (list + revoke) via `api/shares`.
