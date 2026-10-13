import { Controller, Delete, HttpCode, HttpStatus, Param } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AdminService } from './admin.service'

@ApiTags('admin')
@Controller('api/v1/admin/files')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file record and its blob (admin-only, idempotent)' })
  @ApiResponse({ status: 204, description: 'File deleted or already absent' })
  async deleteFile(@Param('fileId') fileId: string): Promise<void> {
    await this.admin.deleteFile(fileId)
  }
}
