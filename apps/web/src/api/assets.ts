import { api } from './client';
import type {
  Asset,
  AssetLayoutIndex,
  AssetLayoutPage,
  AssetListResponse,
  AssetDetectionsResponse,
  FileExistsCheckHit,
  FileExistsCheckItem,
  FileExistsCheckResponse,
  SearchResponse,
} from '@photox/shared-types';

interface ListAssetsParams {
  limit?: number;
  offset?: number;
  /** Opaque next-page token from `AssetListResponse.nextCursor`. */
  cursor?: string;
  isTrashed?: boolean;
  favorite?: boolean;
  hasLocations?: boolean;
  // half-open range on COALESCE(takenAt, uploadedAt) — the timeline's per-month window
  dateFrom?: string;
  dateTo?: string;
  /** Restricts to one person's assets (person detail grid) */
  personId?: string;
  /** Restricts to one album's assets (album detail grid) */
  albumId?: string;
}

/** Asset-list/layout filters shared by the timeline-backed views (home, favorites, person, album). */
export interface AssetFilters {
  personId?: string;
  favorite?: boolean;
  albumId?: string;
}

export async function listAssets(params: ListAssetsParams = {}): Promise<AssetListResponse> {
  // the trash is the same collection filtered by state — `isTrashed` rides along like any filter
  const { data } = await api.get<AssetListResponse>('/v1/assets', { params });
  return data;
}

/**
 * Walks `nextCursor` until the server stops. `limit` is the page size, not a cap; an empty first
 * page returns []. Cursor (not offset) paging keeps pages disjoint when the library changes
 * mid-scroll — an upload landing between two offset pages repeated the last row of the previous one.
 */
export async function listAllAssets(params: ListAssetsParams = {}): Promise<Asset[]> {
  const limit = params.limit ?? 100;
  const all: Asset[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listAssets({ ...params, limit, offset: 0, cursor });
    all.push(...page.items);
    // a repeated cursor would loop forever on a server bug
    if (!page.nextCursor || page.nextCursor === cursor) return all;
    cursor = page.nextCursor;
  }
}

export async function getAsset(assetId: string): Promise<Asset> {
  const { data } = await api.get<Asset>(`/v1/assets/${assetId}`);
  return data;
}

/** Layout filters plus the IANA zone whose local calendar months define the windows. */
export interface AssetLayoutIndexParams extends AssetFilters {
  tz: string;
}

/** Month index: the revalidation call — version per window, no items. */
export async function getAssetLayoutIndex(
  params: AssetLayoutIndexParams,
): Promise<AssetLayoutIndex> {
  const { data } = await api.get<AssetLayoutIndex>('/v1/timeline/index', { params });
  return data;
}

export interface AssetLayoutPageParams extends AssetFilters {
  from: string;
  to: string;
  offset?: number;
  limit?: number;
}

/** One offset page of a month window; walk `nextOffset` until it is null. */
export async function getAssetLayoutPage(params: AssetLayoutPageParams): Promise<AssetLayoutPage> {
  const { data } = await api.get<AssetLayoutPage>('/v1/timeline/window', { params });
  return data;
}

/**
 * Thumbnail / derivative bytes by file id. One file per size with no variant decision to make, so
 * the id alone identifies the bytes; `GET /assets/:id/content` is for the original-vs-transcode
 * choice, which only the server can make.
 *
 * Same-origin URL for direct <img>/<video> use: the browser attaches the auth cookie itself,
 * which axios can't do for those tags (it sends no headers there at all).
 */
export function getThumbStreamUrl(fileId: string): string {
  return `/api/v1/files/${fileId}/stream`;
}

/**
 * The bytes to display: the webm transcode once the worker produced one, else the original. `v` is
 * the server-issued cache token — it changes exactly when that decision changes, which keeps
 * `Cache-Control: immutable` on the byte route correct.
 */
export function getAssetContentUrl(asset: Pick<Asset, 'id' | 'contentVersion'>): string {
  return `/api/v1/assets/${asset.id}/content?v=${encodeURIComponent(asset.contentVersion)}`;
}

/** The uploaded bytes, never the derivative — for "view original" and downloads. */
export function getAssetOriginalUrl(asset: Pick<Asset, 'id' | 'fileId'>): string {
  return `/api/v1/assets/${asset.id}/content?variant=original&v=${encodeURIComponent(asset.fileId)}`;
}

/** Same-origin URL the browser downloads natively: bytes stream straight to disk (no Blob). */
export function getAssetDownloadUrl(asset: Pick<Asset, 'id' | 'fileId'>): string {
  return `/api/v1/assets/${asset.id}/content/download?v=${encodeURIComponent(asset.fileId)}`;
}

/**
 * HEADs the download route first so the axios refresh/401-retry interceptors run and auth or
 * missing-file errors throw here — the caller then skips the anchor click instead of the tab
 * navigating to a JSON error page mid-download.
 */
export async function preflightAssetDownload(asset: Pick<Asset, 'id' | 'fileId'>): Promise<void> {
  await api.head(`/v1/assets/${asset.id}/content/download?v=${encodeURIComponent(asset.fileId)}`);
}

/**
 * Sniffing sets `kind` server-side; the multipart DTO has no client field for it.
 */
export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void,
  title?: string,
  description?: string,
  takenAt?: string,
): Promise<Asset> {
  const formData = new FormData();
  formData.append('file', file);
  if (title) formData.append('title', title);
  if (description) formData.append('description', description);
  if (takenAt) formData.append('takenAt', takenAt);

  const { data } = await api.post<Asset>('/v1/files', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 3_600_000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function updateAsset(
  id: string,
  body: { favorite?: boolean; title?: string; description?: string; takenAt?: string },
): Promise<Asset> {
  const { data } = await api.patch<Asset>(`/v1/assets/${id}`, body);
  return data;
}

export async function trashAsset(assetId: string): Promise<void> {
  await api.post(`/v1/assets/${assetId}/trash`);
}

export async function restoreAsset(assetId: string): Promise<void> {
  await api.delete(`/v1/assets/${assetId}/trash`);
}

export async function deleteAsset(assetId: string): Promise<void> {
  await api.delete(`/v1/assets/${assetId}`);
}

export async function emptyTrash(): Promise<void> {
  await api.delete('/v1/assets', { params: { isTrashed: true } });
}

export async function reprocessThumbnails(assetId: string): Promise<void> {
  await api.post(`/v1/assets/${assetId}/reprocess-thumbnails`);
}

export async function reprocessVideo(assetId: string): Promise<void> {
  await api.post(`/v1/assets/${assetId}/reprocess-video`);
}

export async function trashAssets(assetIds: string[]): Promise<void> {
  await api.post('/v1/assets/bulk-trash', { assetIds });
}

interface SearchParams {
  q: string;
  limit?: number;
  offset?: number;
}

export async function searchAssets(params: SearchParams): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>('/v1/search', { params });
  return data;
}

/** Visually similar assets (image-embedding ANN). Server default limit 12, max 100. */
export async function getSimilarAssets(assetId: string): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>(`/v1/assets/${assetId}/similar`);
  return data;
}

/** Perceptual duplicates within the Hamming threshold. Server default 10, max 64. */
export async function getAssetDuplicates(assetId: string): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>(`/v1/assets/${assetId}/duplicates`);
  return data;
}

export async function getAssetDetections(assetId: string): Promise<AssetDetectionsResponse> {
  const { data } = await api.get<AssetDetectionsResponse>(`/v1/assets/${assetId}/detections`);
  return data;
}

/** Exists-check budget: a stalled check throws, and the caller fail-open uploads. */
export const CHECK_FILES_EXIST_TIMEOUT_MS = 20_000;

export async function checkFilesExist(
  items: FileExistsCheckItem[],
  options: { timeout?: number } = {},
): Promise<FileExistsCheckHit[]> {
  const { data } = await api.post<FileExistsCheckResponse>(
    '/v1/files/exists',
    {
      items,
    },
    { timeout: options.timeout ?? CHECK_FILES_EXIST_TIMEOUT_MS },
  );
  return data.items;
}
