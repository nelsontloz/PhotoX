import { Body, Controller, Get, Put } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import {
  FACE_DETECTOR_KINDS,
  type FaceDetectionSettings,
  type FaceDetectorKind,
} from '@photox/shared-types'
import { SettingsService } from '../settings/settings.service'

class SetFaceDetectorDto {
  @IsIn(FACE_DETECTOR_KINDS)
  detector!: FaceDetectorKind
}

@ApiTags('admin')
@Controller('api/v1/admin/face-detection')
export class AdminFacesController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Face detector setting, env default and model availability (admin-only)',
  })
  @ApiResponse({ status: 200, description: 'Current face detection settings' })
  async getSettings(): Promise<FaceDetectionSettings> {
    return this.settings.getSettings()
  }

  @Put()
  @ApiOperation({ summary: 'Set the face detector used for new face jobs (admin-only)' })
  @ApiResponse({ status: 200, description: 'Updated face detection settings' })
  async updateSettings(@Body() dto: SetFaceDetectorDto): Promise<FaceDetectionSettings> {
    await this.settings.setFaceDetector(dto.detector)
    return this.settings.getSettings()
  }
}
