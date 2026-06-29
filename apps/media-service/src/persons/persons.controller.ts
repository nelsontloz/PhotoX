import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { PersonsService } from './persons.service'
import { CreatePersonDto } from './dto/create-person.dto'
import { UpdatePersonDto } from './dto/update-person.dto'
import { CoverPersonDto } from './dto/cover-person.dto'
import { ReassignFacesDto } from './dto/reassign-faces.dto'
import { ListPersonsQueryDto } from './dto/list-persons-query.dto'
import type {
  PersonListResponse,
  PersonDto,
  PersonAssetsResponse,
  ReassignFacesResponse,
} from '@photox/shared-types'

@ApiTags('persons')
@Controller('v1/persons')
export class PersonsController {
  constructor(private readonly persons: PersonsService) {}

  @Get()
  @ApiOperation({ summary: 'List persons for a user' })
  @ApiResponse({ status: 200, description: 'Paginated person list' })
  async list(@Query() q: ListPersonsQueryDto): Promise<PersonListResponse> {
    return this.persons.list(q.userId, q.limit ?? 20, q.offset ?? 0)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a person from a face cluster' })
  @ApiResponse({ status: 201, description: 'Person created' })
  async create(@Body() dto: CreatePersonDto) {
    return this.persons.create(dto.userId, dto.clusterLabel)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single person' })
  @ApiResponse({ status: 200, description: 'Person found' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async getOne(@Param('id') id: string, @Query('userId') userId: string): Promise<PersonDto> {
    return this.persons.getOne(userId, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a person' })
  @ApiResponse({ status: 200, description: 'Person updated' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async update(
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Body() dto: UpdatePersonDto,
  ): Promise<PersonDto> {
    return this.persons.update(userId, id, dto.name)
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Get distinct assets containing this person' })
  @ApiResponse({ status: 200, description: 'Person assets' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  async getAssets(
    @Param('id') id: string,
    @Query() q: ListPersonsQueryDto,
  ): Promise<PersonAssetsResponse> {
    return this.persons.getAssetsForPerson(q.userId, id, q.limit ?? 20, q.offset ?? 0)
  }

  @Patch(':id/cover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set the cover face for a person' })
  @ApiResponse({ status: 200, description: 'Cover set' })
  @ApiResponse({ status: 404, description: 'Person or face not found' })
  async setCover(@Param('id') id: string, @Body() dto: CoverPersonDto) {
    return this.persons.setCover(dto.userId, id, dto.faceId)
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reassign faces between persons' })
  @ApiResponse({ status: 200, description: 'Faces reassigned' })
  async reassign(
    @Param('id') _id: string,
    @Query('userId') userId: string,
    @Body() dto: ReassignFacesDto,
  ): Promise<ReassignFacesResponse> {
    return this.persons.reassignFaces(userId, dto)
  }
}
