import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUserId } from '../auth/jwt-auth.guard'
import { AssetsService } from '../assets/assets.service'
import { ListAssetsQueryDto } from '../assets/dto/list-assets-query.dto'
import { RegisterThumbnailDto } from '../assets/dto/register-thumbnail.dto'
import { UserFilesService } from '../files/user/user-files.service'
import { RegisterFileBodyDto } from '../files/user/dto/register-file.body.dto'
import { FacesService } from '../faces/faces.service'
import { RegisterFacesDto } from '../faces/dto/register-faces.dto'
import { PersonsService } from '../persons/persons.service'
import { ApplyClustersDto } from '../persons/dto/apply-clusters.dto'
import { EmbeddingsService } from '../embeddings/embeddings.service'
import { RegisterEmbeddingDto } from '../embeddings/dto/register-embedding.dto'
import { DetectionsService } from '../detections/detections.service'
import { RegisterDetectionsDto } from '../detections/dto/register-detections.dto'
import { WorkerMetadataDto } from './dto/worker-metadata.dto'
import { ListFacesQueryDto } from './dto/list-faces-query.dto'
import { PurgeUserDto } from './dto/purge-user.dto'
import { UserDeleteService } from '../users/admin/user-delete.service'

// Worker job surface (agreed interface with the worker lane — do not rename paths). Every route
// is act-required via JwtAuthGuard; ownership is scoped by the job's sub through the reused
// user services, which are unchanged.
@ApiTags('worker')
@Controller('worker')
export class WorkerController {
  constructor(
    private readonly assets: AssetsService,
    private readonly files: UserFilesService,
    private readonly faces: FacesService,
    private readonly persons: PersonsService,
    private readonly embeddings: EmbeddingsService,
    private readonly detections: DetectionsService,
    private readonly deletes: UserDeleteService,
  ) {}

  @Get('assets')
  @ApiOperation({ summary: 'Worker batch read of assets by ids (job user scope)' })
  @ApiResponse({ status: 200, description: 'Paginated asset list' })
  async listAssets(@Query() q: ListAssetsQueryDto, @CurrentUserId() userId: string) {
    // same scoped list service as the user route: sub-scoped, 200 + [] when no rows match,
    // preserving the enumeration-guard semantics (never leaks foreign rows)
    return this.assets.list(userId, q)
  }

  @Get('assets/:id')
  @ApiOperation({ summary: 'Worker read of a single asset (job user scope)' })
  async getAsset(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.getOne(userId, id)
  }

  @Get('files/:id')
  @ApiOperation({ summary: 'Worker read of a file record (job user scope)' })
  async getFile(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.files.getOne(userId, id)
  }

  @Patch('assets/:id/metadata')
  @ApiOperation({ summary: 'Worker write of extracted metadata' })
  async patchMetadata(
    @Param('id') id: string,
    @Body() dto: WorkerMetadataDto,
    @CurrentUserId() userId: string,
  ) {
    return this.assets.updateMetadata(id, userId, dto)
  }

  @Post('assets/:id/faces')
  @ApiOperation({ summary: 'Worker register of detected faces' })
  @ApiResponse({ status: 201, description: 'Faces registered' })
  async registerFaces(
    @Param('id') id: string,
    @Body() dto: RegisterFacesDto,
    @CurrentUserId() userId: string,
  ) {
    return this.faces.registerFaces(id, userId, dto.faces)
  }

  @Delete('assets/:id/faces')
  @ApiOperation({ summary: 'Worker delete of all detected faces for an asset (idempotent)' })
  async deleteFaces(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.faces.deleteForAsset(userId, id)
  }

  @Post('assets/:id/embedding')
  @ApiOperation({ summary: 'Worker register of the image embedding (idempotent upsert)' })
  @ApiResponse({ status: 201, description: 'Embedding registered' })
  async registerEmbedding(
    @Param('id') id: string,
    @Body() dto: RegisterEmbeddingDto,
    @CurrentUserId() userId: string,
  ): Promise<{ ok: true }> {
    return this.embeddings.register(id, userId, dto)
  }

  @Post('assets/:id/detections')
  @ApiOperation({ summary: "Worker replace of the asset's detected objects" })
  @ApiResponse({ status: 201, description: 'Detection set replaced' })
  async registerDetections(
    @Param('id') id: string,
    @Body() dto: RegisterDetectionsDto,
    @CurrentUserId() userId: string,
  ): Promise<{ ok: true }> {
    return this.detections.register(id, userId, dto)
  }

  @Post('assets/:id/thumbnails')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Worker register of a thumbnail (idempotent upsert on assetId+size)' })
  @ApiResponse({ status: 201, description: 'Thumbnail registered' })
  async registerThumbnail(
    @Param('id') id: string,
    @Body() dto: RegisterThumbnailDto,
    @CurrentUserId() userId: string,
  ) {
    return this.assets.registerThumbnail(userId, id, dto)
  }

  @Post('files/register')
  @ApiOperation({ summary: 'Worker register of a file whose bytes were already written' })
  @ApiResponse({ status: 201, description: 'File registered' })
  @ApiResponse({ status: 200, description: 'Existing file returned for the same checksum' })
  async registerFile(
    @CurrentUserId() userId: string,
    @Body() body: RegisterFileBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, created } = await this.files.register(userId, body)
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK)
    return file
  }

  @Get('faces')
  @ApiOperation({ summary: 'Worker list of faces for clustering (job user scope)' })
  async listFaces(@Query() q: ListFacesQueryDto, @CurrentUserId() userId: string) {
    const includeEmbeddings = q.includeEmbeddings ?? false
    const excludeTrashed = q.excludeTrashed ?? false
    return this.faces.listForUserPaginated(userId, {
      limit: q.limit ?? 500,
      cursor: q.cursor,
      includeEmbeddings,
      excludeTrashed,
    })
  }

  @Post('persons/apply-clusters')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Worker apply of a face clustering plan' })
  async applyClusters(@CurrentUserId() userId: string, @Body() dto: ApplyClustersDto) {
    return this.persons.applyClusters(userId, dto)
  }

  @Post('persons/prune-empty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Worker delete of persons with no live faces' })
  async pruneEmpty(@CurrentUserId() userId: string): Promise<{ deleted: number }> {
    return this.persons.pruneEmpty(userId)
  }

  // The `user-delete` queue consumer lives in the worker-service (no DB access), so the wipe
  // itself is requested here. The route target must be the job's own sub: the job binding
  // already pins (sub, scope=userId), and this keeps a purge from ever naming another account.
  @Post('users/:id/purge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Worker-triggered full wipe of the job user account' })
  async purgeUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PurgeUserDto,
    @CurrentUserId() userId: string,
  ) {
    if (id !== userId) throw new ForbiddenException('Purge target must be the job user')
    return this.deletes.purge(id, dto.backupPrefix)
  }
}
