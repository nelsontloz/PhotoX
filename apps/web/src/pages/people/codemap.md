# apps/web/src/pages/people/

## Responsibility

Two routes: `/people` (`index.tsx`) — grid of detected people with a clustering trigger; `/people/:id` (`[id].tsx`) — one person's assets with the matching face box highlighted, renaming, and the shared viewer.

## Design

- Index fetches all persons on mount via `listAllPersons()` (`api/persons` — pages `GET /v1/persons` at 200/page until `total`; local state, no hook/store). Cards link to `/people/:id`, showing `FaceThumb` on `coverFaceId` or a smile placeholder with `clusterLabel`, plus name (`'Unknown'` fallback) and `faceCount`.
- "Run clustering" calls `triggerCluster()` (worker enqueues `process-faces-cluster`), shows a transient "Clustering queued" badge, then polls `listAllPersons()` every 3s for up to 30s (`ponytail` comment acknowledges the crude poll — no websocket/push).
- Detail: parallel `getPerson(id)` + `getPersonAssets(id, {limit: 100})`, then a second wave of `Promise.all(getAsset(item.assetId))` for each item to obtain `faces` + dimensions; a `Map<assetId, FaceDto>` is built by matching `item.faceId` against the asset's faces.
- Each `GalleryItem` receives an `overlay` prop with `<FaceOverlay faces={[face]} imageWidth imageHeight />` so the person's face is boxed in the grid; `selectedAsset` opens the lazy `AssetViewer` with `hasPrev/hasNext=false`, sibling strip from the loaded assets, no trash action, and `AlbumPickerDialog` for add-to-album.
- Inline rename on the title (`renamePerson(id, nameValue || null)`, Enter or blur commits; empty string clears to null). Loading/not-found states are wrapped in `RequireAuth`+`AppShell` too.
- Person detail does not use `useAssetNavigation`: selection is a plain `useState<Asset>`, so it has no URL persistence, no prev/next arrows, and no trash action.
- The clustering poll has no unmount cleanup — it stops only after the 30s cap, matching the ponytail note.
- Detail overlays require backend `width`/`height`; when missing, that tile renders without a face box rather than mis-positioning one.
- `faceCount` doubles as a primary key sanity signal on cards (singular/plural handled) and is refreshed by the 3s polling loop while clustering runs. Empty clusters are pruned core-side by the cluster run (`POST /api/v1/persons/prune-empty`, triggered by the worker even on no-op runs) and simply disappear from the refetched list — no UI code involved.

## Flow

Index → persons list (or empty state) → clustering mutation → polled refetch. Detail → person + asset/face fetch → grid with overlays → click a tile → viewer (no prev/next) → sibling strip or rename/add-to-album from there. Failures are mostly silent (`/* ponytail: silent fail */`), leaving empty states.

## Integration

`api/persons` (`listPersons`, `listAllPersons`, `getPerson`, `getPersonAssets`, `renamePerson`, `triggerCluster`), `api/assets` (`getAsset`), `components/{RequireAuth,AppShell,GalleryItem,FaceThumb,AlbumPickerDialog,AssetViewer}` and `components/AssetViewer/FaceOverlay`. Types `PersonDto`, `FaceDto`, `Asset` from `@photox/shared-types`.
