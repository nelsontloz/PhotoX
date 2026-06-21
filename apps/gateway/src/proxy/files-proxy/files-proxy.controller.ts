import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  HttpException,
  BadGatewayException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { CurrentUser, type CurrentUser as CurrentUserType } from '../../auth/current-user.decorator'
import { ProxyService } from '../proxy.service'
import { buildHeaders } from '../common/headers'
import { SERVICE_URLS } from '@photox/shared-config'
import { randomUUID } from 'crypto'

@ApiTags('files')
@Controller('api/v1/files')
export class FilesProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file (streaming pass-through)' })
  @ApiResponse({ status: 201, description: 'File uploaded' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async upload(@Req() req: Request, @CurrentUser() user: CurrentUserType) {
    const requestId = (req.headers['x-request-id'] as string) ?? ''
    const headers = buildHeaders(user, requestId, { 'x-idempotency-key': randomUUID() })

    return this.proxy.forwardRawBody(
      `${SERVICE_URLS['file-storage-service']}/v1/files`,
      req,
      headers,
    )
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiResponse({ status: 200, description: 'File record' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType, @Req() req: Request) {
    return this.proxy.forward(SERVICE_URLS['file-storage-service'], {
      method: 'GET',
      path: `v1/files/${id}`,
      headers: buildHeaders(user, (req.headers['x-request-id'] as string) ?? ''),
    })
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download file (streaming)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const requestId = (req.headers['x-request-id'] as string) ?? ''
    const headers = buildHeaders(user, requestId)

    const response = await this.proxy.forwardStream(
      `${SERVICE_URLS['file-storage-service']}/v1/files/${id}/download`,
      headers,
    )

    if (response.status >= 400) {
      if (response.status < 500) {
        throw new HttpException('Upstream error', response.status)
      }
      throw new BadGatewayException({
        statusCode: 502,
        upstream: SERVICE_URLS['file-storage-service'],
        message: 'Download upstream error',
        traceId: requestId,
      })
    }

    for (const [key, value] of Object.entries(response.headers)) {
      if (value && typeof value === 'string') {
        res.setHeader(key, value)
      }
    }

    res.status(response.status)
    response.data.pipe(res)
  }
}
