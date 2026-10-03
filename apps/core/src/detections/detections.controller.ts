import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import type { AssetDetectionsResponse } from '@photox/shared-types'
import { DetectionsService } from './detections.service'
import { RegisterDetectionsDto } from './dto/register-detections.dto'

@ApiTags('detections')
@Controller('api/v1/assets')
export class DetectionsController {
  constructor(private readonly detections: DetectionsService) {}

  @Post(':id/detections')
  @ApiOperation({ summary: "Replace the asset's detected objects (empty array clears)" })
  @ApiResponse({ status: 201, description: 'Detection set replaced' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  @ApiResponse({ status: 422, description: 'Too many detections or invalid label/confidence/box' })
  async registerDetections(
    @Param('id') id: string,
    @Body() dto: RegisterDetectionsDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const userId = (req.user as { id: string }).id
    return this.detections.register(id, userId, dto)
  }

  @Get(':id/detections')
  @ApiOperation({ summary: 'List detected objects for an asset (viewer overlay)' })
  @ApiResponse({ status: 200, description: 'Detections ordered by confidence desc' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async listDetections(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<AssetDetectionsResponse> {
    const userId = (req.user as { id: string }).id
    return this.detections.list(userId, id)
  }
}
