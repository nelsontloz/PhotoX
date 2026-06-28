import { Controller, Get, Param, Query, Res } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Response } from 'express'
import { FaceThumbService } from './face-thumb.service'

@ApiTags('faces')
@Controller('v1/faces')
export class FaceThumbController {
  constructor(private readonly thumbs: FaceThumbService) {}

  @Get(':id/thumb')
  @ApiOperation({ summary: 'Crop a face thumbnail from the source asset on demand' })
  @ApiResponse({ status: 200, description: 'JPEG image bytes' })
  @ApiResponse({ status: 404, description: 'Face, asset, or source bytes not found' })
  async getThumb(
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const bytes = await this.thumbs.getThumb(id, userId, size ? Number(size) : Number.NaN)
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=86400',
    })
    res.status(200).end(bytes)
  }
}
