import { Controller, Get, Query, Req, UseGuards, Logger } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { SERVICE_URLS } from '@photox/shared-config'
import type { AdminUserListResponse, AdminUserRow } from '@photox/shared-types'
import { ProxyService } from '../proxy.service'
import { AdminGuard } from '../../auth/admin.guard'
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query.dto'

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('api/v1/admin/users')
export class AdminUsersProxyController {
  private readonly logger = new Logger(AdminUsersProxyController.name)

  constructor(private readonly proxy: ProxyService) {}

  @Get()
  @ApiOperation({ summary: 'List users with stats (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated user list with asset count and bytes used' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async list(
    @Query() q: ListAdminUsersQueryDto,
    @Req() req: Request,
  ): Promise<AdminUserListResponse> {
    const limit = q.limit ?? 20
    const offset = q.offset ?? 0
    const requestId = (req.headers['x-request-id'] as string) ?? ''

    const userPage = await this.proxy.forward<AdminUserListResponse>(SERVICE_URLS['user-service'], {
      method: 'GET',
      path: 'v1/admin/users',
      query: {
        limit: String(limit),
        offset: String(offset),
        ...(q.q ? { q: q.q } : {}),
        ...(q.sort ? { sort: q.sort } : {}),
        ...(q.role ? { role: q.role } : {}),
      },
      headers: { 'x-request-id': requestId },
      timeout: 5_000,
    })

    const userIds = userPage.data.items.map((u) => u.id)
    if (userIds.length === 0) {
      return userPage.data
    }

    const [assetResult, storageResult] = await Promise.allSettled([
      this.proxy.forward<Record<string, number>>(SERVICE_URLS['media-service'], {
        method: 'GET',
        path: 'v1/admin/users/asset-stats',
        query: { userIds: userIds.join(',') },
        headers: { 'x-request-id': requestId },
        timeout: 5_000,
      }),
      this.proxy.forward<Record<string, number>>(SERVICE_URLS['file-storage-service'], {
        method: 'GET',
        path: 'v1/admin/users/storage-stats',
        query: { userIds: userIds.join(',') },
        headers: { 'x-request-id': requestId },
        timeout: 5_000,
      }),
    ])

    const assetMap = this.unwrapStatsMap(assetResult, 'media-service', requestId)
    const storageMap = this.unwrapStatsMap(storageResult, 'file-storage-service', requestId)

    const items: AdminUserRow[] = userPage.data.items.map((u) => ({
      ...u,
      assetCount: assetMap[u.id] ?? 0,
      bytesUsed: storageMap[u.id] ?? 0,
    }))

    return { ...userPage.data, items }
  }

  private unwrapStatsMap(
    result: PromiseSettledResult<{ status: number; data: Record<string, number> }>,
    serviceName: string,
    requestId: string,
  ): Record<string, number> {
    if (result.status === 'rejected') {
      this.logger.warn({
        msg: 'admin stats call rejected; degrading to zeros',
        service: serviceName,
        requestId,
        error: (result.reason as Error)?.message,
      })
      return {}
    }
    return result.value.data
  }
}
