import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AdminService } from './admin.service'
import { UserIdsQueryDto } from './dto/user-ids.query.dto'

@ApiTags('admin')
@Controller('api/v1/admin/files')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('storage-stats')
  @ApiOperation({ summary: 'Sum file sizes per user (admin-only, trusts the network)' })
  @ApiResponse({ status: 200, description: 'Map of userId to bytes used' })
  async storageStats(@Query() q: UserIdsQueryDto): Promise<Record<string, number>> {
    return this.admin.getStorageStatsByUser(q.userIds ?? [])
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file record and its blob (admin-only, idempotent)' })
  @ApiResponse({ status: 204, description: 'File deleted or already absent' })
  async deleteFile(@Param('fileId') fileId: string): Promise<void> {
    await this.admin.deleteFile(fileId)
  }
}
