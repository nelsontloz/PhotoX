import { Controller, Get, Patch, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { FacesService } from './faces.service'
import { AssignPersonDto } from './dto/assign-person.dto'

@ApiTags('faces-query')
@Controller('v1/faces')
export class FacesQueryController {
  constructor(private readonly faces: FacesService) {}

  @Get()
  @ApiOperation({ summary: 'List faces for a user (used by cluster job)' })
  @ApiResponse({ status: 200, description: 'Face list' })
  async list(
    @Query('userId') userId: string,
    @Query('includeEmbeddings') includeEmbeddings?: string,
  ) {
    const wantEmbeddings = includeEmbeddings === 'true'
    const items = await this.faces.listForUser(userId, wantEmbeddings)
    return { items }
  }

  @Patch(':id/person')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or unassign a face from a person' })
  @ApiResponse({ status: 200, description: 'Face updated' })
  @ApiResponse({ status: 404, description: 'Face not found or userId mismatch' })
  async assignPerson(@Param('id') id: string, @Body() dto: AssignPersonDto) {
    await this.faces.assignPerson(dto.userId, id, dto.personId)
    return { ok: true }
  }
}
