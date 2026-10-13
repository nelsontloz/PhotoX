import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { AdminUserListResponse, AdminUserSortField } from '@photox/shared-types'
import { AdminService } from './admin.service'
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query.dto'

@ApiTags('admin')
@Controller('api/v1/admin/users')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'List all users (admin-only, trusts the network)' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  async list(@Query() q: ListAdminUsersQueryDto): Promise<AdminUserListResponse> {
    const [rawField = 'createdAt', rawDir] = q.sort?.split(':') ?? []
    const field = rawField as AdminUserSortField
    const dir = rawDir === 'asc' ? 'asc' : 'desc'
    return this.admin.listUsers({
      limit: q.limit,
      offset: q.offset,
      q: q.q,
      sortField: field,
      sortDir: dir,
      role: q.role,
    })
  }
}
