import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  Res,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { FilesService } from './files.service'
import { UserIdGuard } from './guards/user-id.guard'
import { FileRecordDto } from './dto/file-record.dto'
import { FileListResponseDto, ListFilesQueryDto } from './dto/list-files-query.dto'

@ApiTags('files')
@Controller('v1/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @UseGuards(UserIdGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file' })
  @ApiResponse({ status: 201, description: 'File uploaded', type: FileRecordDto })
  @ApiResponse({ status: 400, description: 'No file or invalid request' })
  async upload(
    @Req() req: Request,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    return this.filesService.upload(req.userId!, file)
  }

  @Get()
  @UseGuards(UserIdGuard)
  @ApiOperation({ summary: "List the authenticated user's files" })
  @ApiResponse({ status: 200, description: 'Paginated file list', type: FileListResponseDto })
  async list(@Req() req: Request, @Query() query: ListFilesQueryDto) {
    return this.filesService.list(
      req.userId!,
      query.limit ?? 20,
      query.offset ?? 0,
      query.mimeType,
    )
  }

  @Get(':fileId')
  @UseGuards(UserIdGuard)
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiResponse({ status: 200, description: 'File record', type: FileRecordDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getOne(@Req() req: Request, @Param('fileId') fileId: string) {
    return this.filesService.getOne(req.userId!, fileId)
  }

  @Get(':fileId/download')
  @UseGuards(UserIdGuard)
  @ApiOperation({ summary: 'Download file bytes' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(
    @Req() req: Request,
    @Res() res: Response,
    @Param('fileId') fileId: string,
  ) {
    const { stream, record } = await this.filesService.download(req.userId!, fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Disposition': `attachment; filename="${record.originalName}"`,
    })
    stream.pipe(res)
  }

  @Delete(':fileId')
  @UseGuards(UserIdGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file (idempotent)' })
  @ApiResponse({ status: 204, description: 'File deleted' })
  async delete(@Req() req: Request, @Param('fileId') fileId: string) {
    await this.filesService.delete(req.userId!, fileId)
  }
}
