import { api } from './client'
import type { AssetShareDto, ShareListResponse } from '@photox/shared-types'

export async function createShare(assetId: string): Promise<AssetShareDto> {
  const { data } = await api.post<AssetShareDto>('/v1/shares', { assetId })
  return data
}

export async function listShares(): Promise<ShareListResponse> {
  const { data } = await api.get<ShareListResponse>('/v1/shares')
  return data
}

export async function revokeShare(shareId: string): Promise<void> {
  await api.delete(`/v1/shares/${shareId}`)
}

export function getShareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`
}
