import { api } from './client'
import type { RelatedAssetsResponse } from '@photox/shared-types'

/** Visually similar assets (image-embedding ANN). Server default limit 12, max 100. */
export async function getSimilarAssets(
  assetId: string,
  limit?: number,
): Promise<RelatedAssetsResponse> {
  const { data } = await api.get<RelatedAssetsResponse>(`/v1/assets/${assetId}/similar`, {
    params: limit ? { limit } : undefined,
  })
  return data
}

/** Perceptual duplicates within the Hamming threshold. Server default 10, max 64. */
export async function getAssetDuplicates(
  assetId: string,
  threshold?: number,
): Promise<RelatedAssetsResponse> {
  const { data } = await api.get<RelatedAssetsResponse>(`/v1/assets/${assetId}/duplicates`, {
    params: threshold != null ? { threshold } : undefined,
  })
  return data
}
