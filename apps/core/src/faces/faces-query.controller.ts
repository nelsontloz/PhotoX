import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUserId } from '../auth/jwt-auth.guard'
import { FacesService } from './faces.service'
import { AssignPersonDto } from './dto/assign-person.dto'
import { FaceThumbQueryDto } from './dto/face-thumb-query.dto'

@ApiTags('faces-query')
@Controller('api/v1/faces')
export class FacesQueryController {
  constructor(private readonly faces: FacesService) {}

  @Get(':id/thumb')
  @ApiOperation({ summary: 'Crop a face thumbnail from the source asset on demand' })
  @ApiResponse({ status: 200, description: 'JPEG image bytes' })
  @ApiResponse({ status: 404, description: 'Face, asset, or source bytes not found' })
  async getThumb(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Res() res: Response,
    @Query() q: FaceThumbQueryDto,
  ): Promise<void> {
    const bytes = await this.faces.getThumb(id, userId, q.size ?? Number.NaN)
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
    res.status(200).end(bytes)
  }

  @Patch(':id/person')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or unassign a face from a person' })
  @ApiResponse({ status: 200, description: 'Face updated' })
  @ApiResponse({ status: 404, description: 'Face not found or userId mismatch' })
  async assignPerson(
    @Param('id') id: string,
    @Body() dto: AssignPersonDto,
    @CurrentUserId() userId: string,
  ) {
    await this.faces.assignPerson(userId, id, dto.personId)
    return { ok: true }
  }
}
