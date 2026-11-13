import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type {
  UploadCompleteResponse,
  UploadSessionCreated,
  UploadSessionStatusResponse,
} from '@photox/shared-types';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { UPLOAD_CHUNK_SIZE_BYTES, UploadsService } from './uploads.service';
import { ingestErrorBody } from '../common/ingest-errors';
import { CreateUploadSessionBodyDto } from './dto/create-upload-session.body.dto';

/**
 * Reads one raw part body with a hard memory bound (never more than one chunk plus a stream
 * chunk buffered). `Content-Length` is mandatory: without it an oversized part could only be
 * detected after buffering it, and a declared length outside 1..maxBytes is refused before any
 * bytes are read. An over-limit body keeps draining after buffering stops, so the answer is a
 * normal 400 instead of a reset connection.
 */
export async function readPartBody(req: Request, maxBytes: number): Promise<Buffer> {
  const header = req.headers['content-length'];
  const declared = typeof header === 'string' && /^\d+$/.test(header) ? Number(header) : null;
  if (declared === null) {
    throw new BadRequestException(
      ingestErrorBody(400, 'Content-Length header is required for part uploads', 'MISSING_LENGTH'),
    );
  }
  if (declared === 0 || declared > maxBytes) {
    throw new BadRequestException(
      ingestErrorBody(400, `Part must be 1..${maxBytes} bytes, got ${declared}`, 'PART_TOO_LARGE'),
    );
  }
  if (req.readableEnded) {
    // the default json/urlencoded parsers already consumed this body (wrong content type)
    throw new BadRequestException(ingestErrorBody(400, 'Part body is empty', 'PART_TOO_LARGE'));
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      if (overflow) return;
      size += chunk.length;
      if (size > maxBytes) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve());
    req.on('error', (err) => reject(err));
    req.on('aborted', () => reject(new BadRequestException('Part upload aborted by the client')));
  });

  if (overflow) {
    throw new BadRequestException(
      ingestErrorBody(400, `Part must be at most ${maxBytes} bytes`, 'PART_TOO_LARGE'),
    );
  }
  const body = Buffer.concat(chunks);
  if (body.length === 0) {
    throw new BadRequestException(ingestErrorBody(400, 'Part body is empty', 'PART_TOO_LARGE'));
  }
  return body;
}

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('api/v1/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a resumable upload session (8 MiB chunks)' })
  @ApiResponse({ status: 201, description: 'Session created', type: Object })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 409, description: 'SESSION_LIMIT — too many active sessions' })
  @ApiResponse({ status: 413, description: 'SIZE_LIMIT or QUOTA_EXCEEDED' })
  async create(
    @CurrentUserId() userId: string,
    @Body() body: CreateUploadSessionBodyDto,
  ): Promise<UploadSessionCreated> {
    return this.uploads.create(userId, body);
  }

  @Get(':uploadId')
  @ApiOperation({ summary: 'Get session status and the parts received so far' })
  @ApiResponse({ status: 200, description: 'Session status', type: Object })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 410, description: 'SESSION_EXPIRED' })
  async status(
    @CurrentUserId() userId: string,
    @Param('uploadId') uploadId: string,
  ): Promise<UploadSessionStatusResponse> {
    return this.uploads.status(userId, uploadId);
  }

  @Put(':uploadId/parts/:index')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Upload one raw chunk (idempotent per index)' })
  @ApiResponse({ status: 204, description: 'Part stored' })
  @ApiResponse({ status: 400, description: 'MISSING_LENGTH, INDEX_RANGE or PART_TOO_LARGE' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 409, description: 'PART_CONFLICT' })
  @ApiResponse({ status: 410, description: 'SESSION_EXPIRED' })
  async putPart(
    @CurrentUserId() userId: string,
    @Param('uploadId') uploadId: string,
    @Param('index') index: string,
    @Req() req: Request,
    @Headers('x-part-sha256') declaredSha256?: string,
  ): Promise<void> {
    // transport cap first (rejects oversized parts before buffering), then the service's rules
    const body = await readPartBody(req, UPLOAD_CHUNK_SIZE_BYTES);
    await this.uploads.putPart(userId, uploadId, index, body, declaredSha256 ?? null);
  }

  @Post(':uploadId/complete')
  @ApiOperation({
    summary: 'Assemble the parts, dedup by checksum and create the asset',
    description:
      'Ingest door 2 of 2. Answers 201 when this request stored new bytes and 200 when it did ' +
      'not (checksum already owned, session already completed, or an enqueue retry). A duplicate ' +
      'is success, not a conflict; `deduplicated` is the same fact in the body.',
  })
  @ApiResponse({ status: 201, description: 'New bytes stored, asset created' })
  @ApiResponse({
    status: 200,
    description: 'No new bytes stored; the existing asset is returned with deduplicated=true',
  })
  @ApiResponse({ status: 400, description: 'UNSUPPORTED_TYPE' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 409, description: 'PARTS_MISSING' })
  @ApiResponse({ status: 410, description: 'SESSION_EXPIRED' })
  @ApiResponse({ status: 413, description: 'QUOTA_EXCEEDED' })
  @ApiResponse({ status: 422, description: 'CHECKSUM_MISMATCH' })
  @ApiResponse({ status: 503, description: 'ENQUEUE_FAILED — the session stays retryable' })
  async complete(
    @CurrentUserId() userId: string,
    @Param('uploadId') uploadId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UploadCompleteResponse> {
    const result = await this.uploads.complete(userId, uploadId);
    res.status(result.deduplicated ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Delete(':uploadId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Abort a session — removes its row and bytes (idempotent)' })
  @ApiResponse({ status: 204, description: 'Session removed' })
  async remove(
    @CurrentUserId() userId: string,
    @Param('uploadId') uploadId: string,
  ): Promise<void> {
    await this.uploads.remove(userId, uploadId);
  }
}
