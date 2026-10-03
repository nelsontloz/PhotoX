import { api } from './client'
import type { CreateShareRequest, ShareDto, ShareListResponse } from '@photox/shared-types'

export async function createShare(target: CreateShareRequest): Promise<ShareDto> {
  const { data } = await api.post<ShareDto>('/v1/shares', target)
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
