import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { FacesService } from './faces.service'
import { RegisterFacesDto } from './dto/register-faces.dto'

@ApiTags('faces')
@Controller('api/v1/assets')
export class FacesController {
  constructor(private readonly faces: FacesService) {}

  @Get(':id/faces')
  @ApiOperation({ summary: 'Get detected faces for an asset' })
  @ApiResponse({ status: 200, description: 'Face list (may be empty)' })
  async getFaces(@Param('id') id: string) {
    const faces = await this.faces.getForAsset(id)
    return { faces }
  }

  @Post(':id/faces')
  @ApiOperation({ summary: 'Register detected faces for an asset' })
  @ApiResponse({ status: 201, description: 'Faces registered' })
  async registerFaces(@Param('id') id: string, @Body() dto: RegisterFacesDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? dto.userId
    return this.faces.registerFaces(id, userId, dto.faces)
  }
}
