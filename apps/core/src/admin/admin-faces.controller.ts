import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { FaceDetectionSettings } from '@photox/shared-types'
import { SettingsService } from '../settings/settings.service'

@ApiTags('admin')
@Controller('api/v1/admin/face-detection')
export class AdminFacesController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'SCRFD face-detector model availability (admin-only)' })
  @ApiResponse({ status: 200, description: 'Current face detection settings' })
  async getSettings(): Promise<FaceDetectionSettings> {
    return this.settings.getSettings()
  }
}
