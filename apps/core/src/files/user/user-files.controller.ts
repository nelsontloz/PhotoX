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
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import multer from 'multer'
import { CurrentUserId } from '../../auth/jwt-auth.guard'
import { UserFilesService, type UploadedDiskFile } from './user-files.service'
import { UploadFileBodyDto } from './dto/upload-file.body.dto'
import { CheckFilesExistsBodyDto } from './dto/check-files-exists.body.dto'
import { serveFileBytes } from '../streaming.util'

const diskStorage = multer.diskStorage({
  destination: tmpdir(),
  filename: (_req, _file, cb) => cb(null, randomUUID()),
})

const uploadOptions = { storage: diskStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } }

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
        kind: { type: 'string', enum: ['photo', 'video'] },
        title: { type: 'string', maxLength: 255 },
        description: { type: 'string', maxLength: 2000 },
        takenAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a file, create its asset and enqueue processing' })
  @ApiResponse({ status: 201, description: 'File uploaded, asset created' })
  @ApiResponse({ status: 400, description: 'No file, unsupported type, or invalid request' })
  @ApiResponse({ status: 409, description: 'File already uploaded' })
  @ApiResponse({ status: 413, description: 'Storage quota exceeded' })
  @ApiResponse({ status: 503, description: 'Failed to enqueue background processing jobs' })
  async upload(
    @CurrentUserId() userId: string,
    @UploadedFile() file: UploadedDiskFile,
    @Body() body: UploadFileBodyDto,
  ) {
    return this.userFilesService.upload(userId, file, body)
  }

  @Post('exists')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch check which checksums already uploaded' })
  @ApiResponse({ status: 200, description: 'Existence hits in input order' })
  async exists(@CurrentUserId() userId: string, @Body() body: CheckFilesExistsBodyDto) {
    const items = await this.userFilesService.existsMany(userId, body.items)
    return { items }
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
    await serveFileBytes(req, res, this.userFilesService, userId, fileId, { attachment: true })
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
    await serveFileBytes(req, res, this.userFilesService, userId, fileId, { attachment: true })
  }
}
