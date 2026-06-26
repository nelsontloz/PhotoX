import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AdminService } from './admin.service'
import { UserIdsQueryDto } from './dto/user-ids.query.dto'

@ApiTags('admin')
@Controller('v1/admin/users')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('storage-stats')
  @ApiOperation({ summary: 'Sum file sizes per user (admin-only, trusts the network)' })
  @ApiResponse({ status: 200, description: 'Map of userId to bytes used' })
  async storageStats(@Query() q: UserIdsQueryDto): Promise<Record<string, number>> {
    return this.admin.getStorageStatsByUser(q.userIds ?? [])
  }
}
