# apps/web/src/pages/shared/

## Responsibility

`/shared` — management list of the user's active public share links: thumbnail, created date, copy-link, and revoke. Creating shares happens in the viewer (`ViewerTopBar`); this page only administers them.

## Design

- Fetches `listShares()` into local state on mount (`loading`/`error` + Retry). No hook or store extraction.
- Each row renders the thumbnail with a raw `<img src="/api/v1/files/:thumbFileId/stream?userId=…">` instead of `AssetThumb`, because the stream endpoint needs the owner's `userId` query param and the thumb is already resolved server-side (`assetThumbFileId`).
- Copy: `getShareUrl(share.token)` → `navigator.clipboard.writeText`, with a per-row "Copied" check for 2s. Revoke: `window.confirm` explaining the link dies for everyone → `revokeShare(id)` → removes the row locally (no refetch).
- Empty state points at the viewer's share icon; the asset itself is identified only by the first 8 chars of `assetId` (no asset title in the DTO — acceptable placeholder).
- Rows are keyed by share id and show only "Shared {date}" plus the truncated asset id; there is no link to the public page or to the owner's viewer.
- The thumbnail URL is built inline (not via `downloadFile`) so the browser caches it and no object URLs need revoking.
- Copy and revoke are optimistic: copy sets a per-row `copiedId` for 2s; revoke filters the row out locally instead of refetching.
- `listShares()` takes no pagination params — the API returns every active link for the user.
- A revoked/expired session on this page is caught by `RequireAuth`'s `subscribeAuthFailure` (redirect to `/login`), not by local error handling.

## Flow

Mount → `listShares()` GET `/api/v1/shares` → rows → copy or confirm-revoke → local list mutation. There is no route to the share's public page from here; the copied URL points at `/share/:token`.

## Integration

`api/shares` (`listShares`, `revokeShare`, `getShareUrl`), `components/{RequireAuth,AppShell}`, type `AssetShareDto`. Shell is `AppShell`; `RequireAuth` handles the auth gate. The reverse operation (create/share asset) is `components/AssetViewer/ViewerTopBar.tsx`.
