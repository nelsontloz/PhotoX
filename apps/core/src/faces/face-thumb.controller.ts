import { BadRequestException, Controller, Get, Param, Query, Req, Res } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { FaceThumbService } from './face-thumb.service'

@ApiTags('faces')
@Controller('api/v1/faces')
export class FaceThumbController {
  constructor(private readonly thumbs: FaceThumbService) {}

  @Get(':id/thumb')
  @ApiOperation({ summary: 'Crop a face thumbnail from the source asset on demand' })
  @ApiResponse({ status: 200, description: 'JPEG image bytes' })
  @ApiResponse({ status: 404, description: 'Face, asset, or source bytes not found' })
  async getThumb(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query('userId') queryUserId?: string,
    @Query('size') size?: string,
  ): Promise<void> {
    const userId = (req.user as { id: string } | undefined)?.id ?? queryUserId
    if (!userId) throw new BadRequestException('userId required')
    const bytes = await this.thumbs.getThumb(id, userId, size ? Number(size) : Number.NaN)
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=86400',
    })
    res.status(200).end(bytes)
  }
}
