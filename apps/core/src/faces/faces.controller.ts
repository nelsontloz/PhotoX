import { Controller, Post, Delete, Param, Body, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { FacesService } from './faces.service'
import { RegisterFacesDto } from './dto/register-faces.dto'

@ApiTags('faces')
@Controller('api/v1/assets')
export class FacesController {
  constructor(private readonly faces: FacesService) {}

  @Post(':id/faces')
  @ApiOperation({ summary: 'Register detected faces for an asset' })
  @ApiResponse({ status: 201, description: 'Faces registered' })
  async registerFaces(@Param('id') id: string, @Body() dto: RegisterFacesDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? dto.userId
    return this.faces.registerFaces(id, userId, dto.faces)
  }

  @Delete(':id/faces')
  @ApiOperation({ summary: 'Delete all detected faces for an asset (idempotent)' })
  @ApiResponse({ status: 200, description: 'Faces deleted (0 when none existed)' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async deleteFaces(@Param('id') id: string, @Req() req: Request) {
    return this.faces.deleteForAsset((req.user as { id: string }).id, id)
  }
}
