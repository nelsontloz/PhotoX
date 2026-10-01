# apps/web/src/api/

## Responsibility

Typed HTTP boundary between the SPA and the core API. One Axios instance plus one thin module per backend resource. No caching, no state — each function fires one request and returns the unwrapped body.

## Design

- `client.ts` exports `api = axios.create({ baseURL: '/api', timeout: 10_000 })`.
- Request interceptor attaches `Authorization: Bearer <accessToken>` read from `useAuthStore.getState()`; nothing is attached when unauthenticated.
- Response interceptor refreshes on 401: skips URLs containing `/v1/auth/`, retries each request at most once via an `X-Auth-Retry` header. It `await`s `useAuthStore.getState().refresh()` and replays the original request with the new token; if there is still no token it rejects.
- Modules mirror core route groups under `/v1/`: `auth.ts` (login/register/refresh/logout), `assets.ts`, `albums.ts`, `faces.ts`, `persons.ts`, `shares.ts`, `admin.ts`. (`persons.reassignFaces` — batch `POST /v1/persons/:id/reassign` — is unused dead code; single-face edits go through `faces.assignFace`.)
- Conventions: types come from `@photox/shared-types`; functions `return data` (no AxiosResponse leakage); list params passed as an object `params`; reads accept optional `AbortSignal`; blob endpoints use `responseType: 'blob'`.
- Timeout overrides for long calls: `downloadFile` 300s, `uploadFile` 3_600_000ms (1h) with `onUploadProgress` → `onProgress(pct)`.
- URL builders (no request): `getVideoStreamUrl(fileId, userId)` → `/api/v1/files/:id/stream?userId=...` for `<video src>` (browser can't send headers; the stream route is in the open-route table, and core ignores the `userId` param), `getShareUrl(token)` → `${origin}/share/:token`.
- `assets.ts` notable: `listAssets` branches to `/v1/assets/trashed` when `isTrashed` and accepts optional `dateFrom`/`dateTo` (half-open range on `COALESCE(takenAt, uploadedAt)` — the timeline's per-month window, composed with the other filters); `getAssetLayout` reads `GET /v1/assets/layout` (compact `{ t, w, h }` list backing timeline virtualization); `uploadFile` posts `FormData` (file, kind, title, description, takenAt); bulk trash via `POST /v1/assets/bulk-trash`; trash/restore/delete/empty-trash + reprocess endpoints.
- `admin.ts` serializes `sortField`/`sortDir` into `sort=field:dir` and wraps `/v1/admin/*` (users, asset counts, thumbnail reprocess, orphan cleanup/counts, face-detection get/set, face reprocess status/trigger, recluster).
- Only unit test here: `assets.spec.ts` asserts `getVideoStreamUrl` path + param encoding.

## Flow

Caller (page/hook/store) → module fn → `api` instance → request interceptor (Bearer) → core `/api/v1/...` → response interceptor (401 → auth store refresh → one retry) → typed `data` back to the caller.

## Integration

- `client.ts` imports `useAuthStore`; hard refresh failure propagates through the store's `authFailureListeners` to `RequireAuth` (redirect to `/login`).
- Consumed by `src/hooks` (albums/assets), `src/lib/upload.ts` (`uploadFile`), `src/store/auth-store.ts` (auth calls) and components (`AssetThumb`, admin/shares/people pages).
- Wire shapes from `@photox/shared-types`; relative `/api` means the same-origin proxy (Vite dev / reverse proxy) is the only possible target.
