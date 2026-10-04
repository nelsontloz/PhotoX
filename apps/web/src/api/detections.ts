import { api } from './client'
import type { AssetDetectionsResponse } from '@photox/shared-types'

export async function getAssetDetections(assetId: string): Promise<AssetDetectionsResponse> {
  const { data } = await api.get<AssetDetectionsResponse>(`/v1/assets/${assetId}/detections`)
  return data
}
