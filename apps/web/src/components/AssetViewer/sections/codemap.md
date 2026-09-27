# apps/web/src/components/AssetViewer/sections/

## Responsibility

Presentational sections stacked inside `ViewerInfoPanel`: `AssetMetadataPanel` (technical details), `FacesSection` (detected faces + person reassignment), `LocationSection` (GPS coordinates). All take the already-refreshed `Asset` as a prop; only `FacesSection` performs its own API work.

## Design

- `AssetMetadataPanel` picks a photo or video row set, filters out null values, and renders a two-column `<dl>`. Video rows include duration, streaming/transcode status (icon-toned: ready/pending/failed), codec, resolution, fps, audio, size, MIME. Uses `formatBytes`/`formatDuration`; pure, no effects.
- `FacesSection` mirrors `asset.faces` into local state and renders one of four states: `faceStatus === 'pending'` (spinner), `'failed'` (warning), empty (`No faces detected`), or a numbered list. When faces exist it loads `listPersons({limit: 200})` once to populate a per-face `<select>` with names/cluster labels. Changing the select calls `reassignFaces(face.personId ?? 'none', {toPersonId: id|null, faceIds: [faceId]})`, then patches local `personId` and adjusts `faceCount` in the person map only when `result.moved > 0` (optimistic-ish, rollback via `window.alert` on throw). Confidence is rendered as a percent bar.
- `LocationSection` formats lat/lng with hemisphere suffixes (N/S, E/W) and links to OpenStreetMap in a new tab; renders an italic empty state when coordinates are missing.
- `FaceRow` keeps the number chip, confidence bar, assigned-person label, and select in one place; if the person list hasn't loaded, an assigned face degrades to the label "Assigned" instead of breaking.
- `transcodeLabel` maps `asset.transcodeStatus` to text + tone (`ok | pending | failed`), and the tone picks the icon rendered in the metadata `<dd>`; `formatFps` drops non-finite/≤0 values so unknown frame rates simply omit the row.
- No data fetching for the asset itself — the panel parent (`AssetViewer`) has already re-fetched it, so faces/dimensions/description are current.
- `FacesSection` treats `asset.faces` as the source of truth on every prop change but keeps a local editable copy; there is no shared store or cache with the People pages.
- Persons with `name === null` fall back to `clusterLabel`, then to `"Unknown"` in the select options.
- Reassignment is unreachable while `faceStatus` is pending/failed because those branches render status text instead of the list.

## Flow

`ViewerInfoPanel` composes `AssetMetadataPanel` → Description block → `FacesSection` → `LocationSection` → static Albums/Keywords/revision placeholders. `FacesSection` observations: `asset.faces` prop changes reset local state via effect; person list loads only when `faces.length > 0`. Reassignment is per-face and immediate; there is no bulk UI here. The section never writes back to the parent's `asset`, so its patches vanish if the viewer re-fetches that asset.

## Integration

Only consumed by `../ViewerInfoPanel.tsx`. `FacesSection` depends on `api/persons` (`listPersons`, `reassignFaces`) and `@photox/shared-types` (`Asset`, `FaceDto`, `PersonDto`); the reassign endpoint is core `api/v1/persons/...`. `LocationSection` needs nothing beyond the `Asset` DTO (`latitude`, `longitude`). Face thumbnails are not rendered here — `FaceThumb` lives in `components/`. Styling is Tailwind with `dark:`-tuned palette matching the rest of the viewer sidebar; shared number/date rendering comes from `lib/format`.
