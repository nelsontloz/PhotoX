// never a controller body: the upload path builds this in code and calls AssetsService.create
export interface CreateAssetDto {
  fileId: string;
  kind: 'photo' | 'video';
  takenAt?: string;
  mimeType?: string;
  sizeBytes?: number;
  originalName?: string;
  title?: string;
  description?: string;
}
