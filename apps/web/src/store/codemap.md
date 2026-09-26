# apps/web/src/store/

## Responsibility

Client-side state via zustand `create` stores — session, timeline refresh signal, decoded thumbnail cache and the persistent upload queue. Server data is not cached here; only cross-component state and transient UI state.

## Design

- `auth-store.ts` (`useAuthStore`) — the core store. State: `user`, `accessToken`, `refreshToken`, `status: 'idle'|'loading'|'authenticated'|'error'`, `error`. Actions: `login`, `register`, `logout` (best-effort API call then clears), `refresh`, `clearError`.
  - Persisted to localStorage as `photox.auth` (`persist` + `createJSONStorage`), `partialize` keeps only user/tokens; `merge` derives `status: 'authenticated'` when a persisted access token exists.
  - Proactive refresh: module-level `useAuthStore.subscribe` → `scheduleRefresh(accessToken)` decodes `JwtPayload.exp` with `jwt-decode` and sets a timer for exp − 5 min (`REFRESH_LEAD_MS`); already-expired tokens refresh immediately.
  - Single-flight: `refreshInFlight` coalesces concurrent `refresh()` calls; success rotates BOTH access and refresh tokens (opaque refresh rotation); failure runs `logout()` then fires every `subscribeAuthFailure(cb)` listener. No-op when `refreshToken` is null.
  - `auth-store.spec.ts` covers login/register/logout/error paths, token rotation, single-flight and the failure listener.
- `app-store.ts` (`useAppStore`) — `timelineRefreshKey` counter + `bumpTimelineRefresh()`; a pub/sub "refetch timeline" signal. `useAssetGroups` subscribes to it; upload batch completion bumps it.
- `thumb-store.ts` (`useThumbStore`) — in-memory `Record<fileId, objectURL>` `set`/`get`. `set` revokes the previous URL for the same key. Populated by optimistic local thumbs (`src/lib/upload.ts`) and read by `AssetThumb` as a fast path before network thumbs. Not persisted — object URLs die on reload.
- `upload-store.ts` (`useUploadStore`) — `items: UploadItem[]` (`queued|uploading|done|error`, progress, assetId/fileId/error, optional `localThumbUrl`) plus `dismissed`; actions `enqueue`, `setProgress`, `setStatus`, `setDismissed`, `clearDone`. Persisted as `photox.upload-queue.v1` (version 1); `partializeItem` never persists `File` objects and rewrites any in-flight item to `status: 'error'`, `'Interrupted by reload — please retry'`, so users don't see a frozen "uploading".
- Components select narrowly (`useAuthStore((s) => s.user)`); imperative code paths use `getState()` (interceptors, upload pipeline, timer).

## Flow

1. Login/register → auth store calls `src/api/auth` → tokens persisted; the subscribe hook schedules the next proactive refresh.
2. Any 401 from `src/api/client.ts` → `refresh()` (single-flight) → new token replayed onto the original request; hard failure → logout + listeners → `RequireAuth` redirects to `/login`.
3. Upload pipeline writes `upload-store` items and `thumb-store` object URLs; `UploadNotification` renders from them; batch completion bumps `app-store.timelineRefreshKey`, which re-fetches asset groups.

## Integration

- `src/api/client.ts` reads/writes auth state (request/response interceptors).
- `src/lib/upload.ts` drives upload + thumb stores and bumps app-store.
- `RequireAuth`/`RequireAdmin`, `AppHeader`/`Sidebar`, login/register pages read auth; `AssetThumb`/`UploadNotification` read thumb; timeline/favorites/trash read the app-store refresh key.
- Auth API calls are the only store → gateway path; everything else reaches the gateway through hooks/components.
