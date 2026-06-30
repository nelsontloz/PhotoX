import { api } from './client'
import type {
  AdminUserListResponse,
  AdminUserSortField,
  AdminAssetCountsResponse,
  AdminReprocessThumbnailsResponse,
} from '@photox/shared-types'

export interface ListAdminUsersParams {
  limit?: number
  offset?: number
  q?: string
  sortField?: AdminUserSortField
  sortDir?: 'asc' | 'desc'
  role?: 'user' | 'admin'
}

export async function listAdminUsers(
  params: ListAdminUsersParams = {},
): Promise<AdminUserListResponse> {
  const sort = params.sortField ? `${params.sortField}:${params.sortDir ?? 'desc'}` : undefined
  const { data } = await api.get<AdminUserListResponse>('/v1/admin/users', {
    params: {
      limit: params.limit,
      offset: params.offset,
      q: params.q,
      sort,
      role: params.role,
    },
  })
  return data
}

export async function getAdminAssetCounts(): Promise<AdminAssetCountsResponse> {
  const { data } = await api.get<AdminAssetCountsResponse>('/v1/admin/assets/counts')
  return data
}

export async function reprocessThumbnails(
  kind: 'photo' | 'video',
): Promise<AdminReprocessThumbnailsResponse> {
  const { data } = await api.post<AdminReprocessThumbnailsResponse>(
    '/v1/admin/thumbnails/reprocess',
    { kind },
  )
  return data
}
