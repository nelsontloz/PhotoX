import { Controller, Get, Param, Req, Res, BadGatewayException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { firstValueFrom } from 'rxjs'
import type { Readable } from 'stream'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { Public } from '../../auth/public.decorator'
import type { PublicShareResponse } from '@photox/shared-types'

@ApiTags('shares')
@Controller('api/share')
export class PublicSharesProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly http: HttpService,
  ) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'View a shared asset by public token' })
  @ApiResponse({ status: 200, description: 'Shared asset info' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async getByToken(@Param('token') token: string, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/shares/public/${token}`,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Public()
  @Get(':token/stream')
  @ApiOperation({ summary: 'Stream a shared asset by public token' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async streamByToken(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const share = await this.proxy.forward<PublicShareResponse>(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/shares/public/${token}`,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    const asset = share.data.asset
    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${asset.fileId}/stream`
    const upstream = await firstValueFrom(
      this.http.get(url, {
        responseType: 'stream',
        params: { userId: asset.userId },
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
          ...(req.headers.range ? { range: req.headers.range } : {}),
        },
        timeout: 300_000,
        validateStatus: () => true,
      }),
    )
    const stream = upstream.data as Readable
    if (upstream.status >= 500) {
      stream.destroy()
      throw new BadGatewayException({
        statusCode: 502,
        upstream: SERVICE_URLS['file-storage-service'],
        message: 'Upstream server error',
      })
    }
    if (upstream.status >= 400) {
      stream.destroy()
      res.status(upstream.status).json({
        statusCode: upstream.status,
        message: upstream.statusText || 'Request failed',
      })
      return
    }
    res.set({
      'Content-Type': upstream.headers['content-type'] as string,
      ...(upstream.headers['content-length']
        ? { 'Content-Length': upstream.headers['content-length'] as string }
        : {}),
      ...(upstream.headers['content-range']
        ? { 'content-range': upstream.headers['content-range'] as string }
        : {}),
      ...(upstream.headers['accept-ranges']
        ? { 'accept-ranges': upstream.headers['accept-ranges'] as string }
        : {}),
    })
    res.status(upstream.status)
    stream.on('error', () => {
      res.destroy()
    })
    res.on('close', () => {
      stream.destroy()
    })
    stream.pipe(res)
  }
}
