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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { AssetsService } from '../assets/assets.service';
import { ListAssetsQueryDto } from '../assets/dto/list-assets-query.dto';
import { RegisterThumbnailDto } from '../assets/dto/register-thumbnail.dto';
import { UserFilesService } from '../ingest/user-files.service';
import { RegisterFileBodyDto } from '../ingest/dto/register-file.body.dto';
import { FacesService } from '../faces/faces.service';
import { RegisterFacesDto } from '../faces/dto/register-faces.dto';
import { PersonsService } from '../persons/persons.service';
import { ApplyClustersDto } from '../persons/dto/apply-clusters.dto';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { RegisterEmbeddingDto } from '../embeddings/dto/register-embedding.dto';
import { DetectionsService } from '../detections/detections.service';
import { RegisterDetectionsDto } from '../detections/dto/register-detections.dto';
import { WorkerMetadataDto } from './dto/worker-metadata.dto';
import { ListFacesQueryDto } from './dto/list-faces-query.dto';
import { PurgeUserDto } from './dto/purge-user.dto';
import { PurgeUserFinishDto } from './dto/purge-user-finish.dto';
import { UserDeleteService } from '../users/admin/user-delete.service';
import type { UserDeleteStepResult, FaceListResponse } from '@photox/shared-types';

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
    return this.assets.list(userId, q);
  }

  @Get('assets/:id')
  @ApiOperation({ summary: 'Worker read of a single asset (job user scope)' })
  async getAsset(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.assets.getOne(userId, id);
  }

  @Get('files/:id')
  @ApiOperation({ summary: 'Worker read of a file record (job user scope)' })
  async getFile(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.files.getOne(userId, id);
  }

  @Patch('assets/:id/metadata')
  @ApiOperation({ summary: 'Worker write of extracted metadata' })
  async patchMetadata(
    @Param('id') id: string,
    @Body() dto: WorkerMetadataDto,
    @CurrentUserId() userId: string,
  ) {
    return this.assets.updateMetadata(id, userId, dto);
  }

  @Post('assets/:id/faces')
  @ApiOperation({ summary: "Worker replace of the asset's detected faces (atomic, idempotent)" })
  @ApiResponse({ status: 201, description: 'Face set replaced' })
  async replaceFaces(
    @Param('id') id: string,
    @Body() dto: RegisterFacesDto,
    @CurrentUserId() userId: string,
  ) {
    return this.faces.replaceForAsset(userId, id, dto.faces);
  }

  @Delete('assets/:id/faces')
  @ApiOperation({ summary: 'Worker delete of all detected faces for an asset (idempotent)' })
  async deleteFaces(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.faces.deleteForAsset(userId, id);
  }

  @Post('assets/:id/embedding')
  @ApiOperation({ summary: 'Worker register of the image embedding (idempotent upsert)' })
  @ApiResponse({ status: 201, description: 'Embedding registered' })
  async registerEmbedding(
    @Param('id') id: string,
    @Body() dto: RegisterEmbeddingDto,
    @CurrentUserId() userId: string,
  ): Promise<{ ok: true }> {
    return this.embeddings.register(id, userId, dto);
  }

  @Post('assets/:id/detections')
  @ApiOperation({ summary: "Worker replace of the asset's detected objects" })
  @ApiResponse({ status: 201, description: 'Detection set replaced' })
  async registerDetections(
    @Param('id') id: string,
    @Body() dto: RegisterDetectionsDto,
    @CurrentUserId() userId: string,
  ): Promise<{ ok: true }> {
    return this.detections.register(id, userId, dto);
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
    return this.assets.registerThumbnail(userId, id, dto);
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
    const { file, created } = await this.files.register(userId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return file;
  }

  @Get('faces')
  @ApiOperation({ summary: 'Worker list of faces for clustering (job user scope)' })
  @ApiResponse({ status: 200, description: 'Keyset page of faces; nextCursor=null ends the walk' })
  async listFaces(
    @Query() q: ListFacesQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<FaceListResponse> {
    return this.faces.listForUserPaginated(userId, q);
  }

  @Post('persons/apply-clusters')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Worker apply of a face clustering plan' })
  async applyClusters(@CurrentUserId() userId: string, @Body() dto: ApplyClustersDto) {
    return this.persons.applyClusters(userId, dto);
  }

  @Post('persons/prune-empty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Worker delete of persons with no live faces' })
  async pruneEmpty(@CurrentUserId() userId: string): Promise<{ deleted: number }> {
    return this.persons.pruneEmpty(userId);
  }

  // The `user-delete` queue consumer lives in the worker-service (no DB access), so the wipe
  // is driven from here in bounded steps: the worker loops `purge/step` until `done`, sweeps
  // the four storage prefixes itself (it owns STORAGE_DIR), then reports `purge/finish`.
  // Every route target must be the job's own sub: the job binding already pins
  // (sub, scope=userId), and this keeps a wipe from ever naming another account.
  @Post('users/:id/purge/step')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Worker-driven bounded step of the job user account wipe' })
  async purgeUserStep(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PurgeUserDto,
    @CurrentUserId() userId: string,
  ): Promise<UserDeleteStepResult> {
    if (id !== userId) throw new ForbiddenException('Purge target must be the job user');
    return this.deletes.step(id, dto.backupPrefix);
  }

  @Post('users/:id/purge/finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Worker terminal report for the job user account wipe' })
  async purgeUserFinish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PurgeUserFinishDto,
    @CurrentUserId() userId: string,
  ): Promise<{ state: string }> {
    if (id !== userId) throw new ForbiddenException('Purge target must be the job user');
    await this.deletes.finish(id, dto);
    return { state: (await this.deletes.getProgress(id))?.state ?? 'unknown' };
  }
}
