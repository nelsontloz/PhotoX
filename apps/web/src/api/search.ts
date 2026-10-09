import { api } from './client'
import type { SearchResponse } from '@photox/shared-types'

interface SearchParams {
  q: string
  limit?: number
  offset?: number
}

export async function searchAssets(params: SearchParams): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>('/v1/search', { params })
  return data
}
