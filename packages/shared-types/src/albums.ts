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
