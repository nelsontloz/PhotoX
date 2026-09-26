# apps/web/src/components/AssetViewer/

## Responsibility

Full-screen lightbox overlay for a single asset: media stage, top action bar, optional details sidebar, keyboard navigation, face boxes, and sibling thumbnail strip. It is the common interaction surface for timeline, favorites, album detail, person detail, and trash — one component, action slots toggled by the host page.

## Design

- Callback-driven, not stateful about navigation. The host page owns selection through `useAssetNavigation` (`?asset=<id>` search param) and passes `asset`, `hasPrev/hasNext`, and action handlers. `AssetViewer` renders `ViewerTopBar` + `ViewerMedia`, plus `ViewerInfoPanel` when info is open.
- `AssetViewer` keeps a local `currentAsset`, re-fetched with `getAsset(asset.id)` when the prop changes (list entries lack faces/dimensions), falling back silently to the prop on failure. `favOverride` gives optimistic favorite feedback until the parent refetch lands.
- Videos: `primaryVideoSrc` = transcode file when present (`getVideoStreamUrl(transcodeFileId ?? fileId, userId)`), `videoFallbackSrc` = original file, so `VideoPlayer` swaps sources when the browser can't decode AV1. User id comes from `useAuthStore` because the stream endpoint needs it.
- `useAssetMedia` resolves a poster/preview: `xl` thumbnail for photos, `lg` for video posters (`listThumbnails` → `downloadFile`), with AbortController and object-URL revocation.
- `useViewerKeyboard` binds Escape/ArrowLeft/ArrowRight; body scroll is locked while mounted.
- Photos are shown as their `xl` thumbnail, with a blurred scaled backdrop copy behind the stage. `FaceOverlay` renders when the info panel is open, the asset has dimensions, and `asset.faces` is non-empty.
- `ViewerTopBar` is action-injected: favorite, download (`downloadFile` + anchor click), share (`createShare` → clipboard `getShareUrl`, 2s check), edit (inert placeholder), reprocess thumbnails/video (`reprocessThumbnails`/`reprocessVideo`, hidden while loading), add/remove album, trash or restore/permanent delete depending on props, and info toggle. It hides share/edit on trashed assets.
- `ViewerThumbnailStrip` shows a 7-item window centered on the current asset and scrolls the active thumb into view; hidden when only one sibling.
- Only one viewer instance exists per page, mounted inside the page DOM with `fixed inset-0 z-50` (no portal) and driven by a single `?asset` param.

## Flow

Tile click → host sets `?asset=<id>` → viewer mounts with the list asset → `getAsset` refresh + media blob fetch → user actions call host callbacks (`onClose`, `onPrev`, `onNext`, `onTrash`, `onRestore`, `onDelete`, `onToggleFavorite`, `onAddToAlbum`, `onRemoveFromAlbum`, `onSelectSibling`) which hit `api/assets` via `useAssetNavigation` and refresh the host list. The viewer never mutates route/search state itself.

## Integration

Lazily imported (`React.lazy`) by timeline `/`, album detail, and person detail; imported eagerly by favorites and trash. Depends on `api/assets` (`getAsset`, `downloadFile`, `listThumbnails`, `reprocess*`), `api/shares`, `store/auth-store`, and sibling folders: `sections/*` (details), `FaceOverlay`, `ViewerThumbnailStrip`, plus `../VideoPlayer` and `../AssetThumb`.
