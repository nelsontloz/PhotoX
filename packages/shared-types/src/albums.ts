import type { Page } from './pagination';

export interface AlbumDto {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  /** When true, assets in this album are excluded from the timeline. */
  hiddenFromTimeline: boolean;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlbumDto {
  name: string;
  description?: string;
  hiddenFromTimeline?: boolean;
}

export interface UpdateAlbumDto {
  name?: string;
  description?: string;
  hiddenFromTimeline?: boolean;
}

export interface AddAssetsToAlbumDto {
  assetIds: string[];
}

/** GET /api/v1/albums — offset-addressed (the collection is small); `total` is the whole count. */
export type AlbumListResponse = Page<AlbumDto>;
