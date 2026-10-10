import { Controller, Get, Patch, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { CurrentUserId } from '../auth/jwt-auth.guard'
import { FacesService } from './faces.service'
import { AssignPersonDto } from './dto/assign-person.dto'
import { isQueryTrue } from '../common/query-params'

@ApiTags('faces-query')
@Controller('api/v1/faces')
export class FacesQueryController {
  constructor(private readonly faces: FacesService) {}

  @Get()
  @ApiOperation({ summary: 'List faces for a user (used by cluster job)' })
  @ApiResponse({ status: 200, description: 'Face list' })
  async list(
    @Query('includeEmbeddings') includeEmbeddings: string | undefined,
    @Query('excludeTrashed') excludeTrashed: string | undefined,
    @CurrentUserId() userId: string,
  ) {
    const wantEmbeddings = isQueryTrue(includeEmbeddings)
    const items = await this.faces.listForUser(userId, wantEmbeddings, isQueryTrue(excludeTrashed))
    return { items }
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
