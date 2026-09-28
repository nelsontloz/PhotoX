import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { FacesService } from './faces.service'
import { AssignPersonDto } from './dto/assign-person.dto'

@ApiTags('faces-query')
@Controller('api/v1/faces')
export class FacesQueryController {
  constructor(private readonly faces: FacesService) {}

  @Get()
  @ApiOperation({ summary: 'List faces for a user (used by cluster job)' })
  @ApiResponse({ status: 200, description: 'Face list' })
  async list(
    @Query('userId') queryUserId: string | undefined,
    @Query('includeEmbeddings') includeEmbeddings: string | undefined,
    @Query('excludeTrashed') excludeTrashed: string | undefined,
    @Req() req: Request,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    const wantEmbeddings = includeEmbeddings === 'true'
    const items = await this.faces.listForUser(userId, wantEmbeddings, excludeTrashed === 'true')
    return { items }
  }

  @Patch(':id/person')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or unassign a face from a person' })
  @ApiResponse({ status: 200, description: 'Face updated' })
  @ApiResponse({ status: 404, description: 'Face not found or userId mismatch' })
  async assignPerson(@Param('id') id: string, @Body() dto: AssignPersonDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? dto.userId
    await this.faces.assignPerson(userId, id, dto.personId)
    return { ok: true }
  }
}
