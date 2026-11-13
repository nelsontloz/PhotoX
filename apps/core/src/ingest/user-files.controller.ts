import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { StorageQuotaResponse } from '@photox/shared-types';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import multer from 'multer';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { UserFilesService, type OriginalFileInput } from './user-files.service';
import { UploadFileBodyDto } from './dto/upload-file.body.dto';
import { CheckFilesExistsBodyDto } from './dto/check-files-exists.body.dto';
import { serveFileBytes } from '../common/streaming.util';

const diskStorage = multer.diskStorage({
  destination: tmpdir(),
  filename: (_req, _file, cb) => cb(null, randomUUID()),
});

const uploadOptions = { storage: diskStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } };

@ApiTags('files')
@ApiBearerAuth()
@Controller('api/v1/files')
export class UserFilesController {
  constructor(private readonly userFilesService: UserFilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string', maxLength: 255 },
        description: { type: 'string', maxLength: 2000 },
        takenAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a file, create its asset and enqueue processing',
    description:
      'Ingest door 1 of 2 (see POST /api/v1/uploads for large/resumable files). The sha256 ' +
      'checksum is the natural key: uploading bytes the user already owns is success, not a ' +
      'conflict. Answers 201 when this request stored new bytes and 200 when they were already ' +
      'owned; both return the same asset (the existing one on a duplicate). No Idempotency-Key ' +
      'is needed — a retried upload is safe by construction.',
  })
  @ApiResponse({ status: 201, description: 'New bytes stored, asset created' })
  @ApiResponse({ status: 200, description: 'Bytes already owned; the existing asset is returned' })
  @ApiResponse({ status: 400, description: 'EMPTY_BODY, UNSUPPORTED_TYPE, or invalid request' })
  @ApiResponse({ status: 413, description: 'QUOTA_EXCEEDED' })
  @ApiResponse({ status: 503, description: 'Failed to enqueue background processing jobs' })
  async upload(
    @CurrentUserId() userId: string,
    @UploadedFile() file: OriginalFileInput,
    @Body() body: UploadFileBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { asset, created } = await this.userFilesService.upload(userId, file, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    res.setHeader('Location', `/api/v1/assets/${asset.id}`);
    return asset;
  }

  @Get('quota')
  @ApiOperation({ summary: 'Storage usage and limit for originals' })
  @ApiResponse({ status: 200, description: 'Used/limit/remaining bytes (limit null = unlimited)' })
  async quota(@CurrentUserId() userId: string): Promise<StorageQuotaResponse> {
    return this.userFilesService.storageQuota(userId);
  }

  @Post('exists')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch check which checksums already uploaded',
    description:
      'Pre-flight for ingest: safe and idempotent (a read expressed as POST for its batch body). ' +
      'A hit carries the existing asset/file ids, so the client can skip the upload entirely.',
  })
  @ApiResponse({ status: 200, description: 'Existence hits in input order' })
  async exists(@CurrentUserId() userId: string, @Body() body: CheckFilesExistsBodyDto) {
    const items = await this.userFilesService.existsMany(userId, body.items);
    return { items };
  }

  @Get(':fileId/stream')
  @ApiOperation({ summary: 'Stream file bytes for video playback (authenticated)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async stream(
    @Param('fileId') fileId: string,
    @Res() res: Response,
    @Req() req: Request,
    @CurrentUserId() userId: string,
  ) {
    await serveFileBytes(req, res, this.userFilesService, userId, fileId, { attachment: true });
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: 'Download file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(
    @Res() res: Response,
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @CurrentUserId() userId: string,
  ) {
    await serveFileBytes(req, res, this.userFilesService, userId, fileId, { attachment: true });
  }
}
