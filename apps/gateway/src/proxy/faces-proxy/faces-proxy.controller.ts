import { Controller, Get, Param, Query, Req, Res, HttpException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'
import { Public } from '../../auth/public.decorator'

@ApiTags('faces')
@Controller('api/v1/faces')
export class FacesProxyController {
  constructor(private readonly http: HttpService) {}

  @Public()
  @Get(':faceId/thumb')
  @ApiOperation({
    summary: 'Crop a face thumbnail (public capability URL, no Authorization header)',
  })
  @ApiResponse({ status: 200, description: 'JPEG image bytes' })
  @ApiResponse({ status: 404, description: 'Face not found' })
  async thumb(
    @Param('faceId') faceId: string,
    @Query('userId') userId: string,
    @Query('size') size: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const url = `${SERVICE_URLS['media-service']}/v1/faces/${faceId}/thumb`
    const upstream = await firstValueFrom(
      this.http.request<ArrayBuffer>({
        method: 'GET',
        url,
        params: { userId, ...(size ? { size } : {}) },
        responseType: 'arraybuffer',
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 30_000,
        validateStatus: () => true,
      }),
    )

    if (upstream.status >= 400) {
      const body = upstream.data
      let parsed: unknown = body
      if (body instanceof Buffer || body instanceof ArrayBuffer) {
        try {
          parsed = JSON.parse(Buffer.from(body).toString('utf8'))
        } catch {
          parsed = { message: 'Upstream error' }
        }
      }
      throw new HttpException(parsed as string | Record<string, unknown>, upstream.status)
    }

    const buf = Buffer.from(upstream.data)
    res.set({
      'Content-Type': (upstream.headers['content-type'] as string) ?? 'image/jpeg',
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'private, max-age=86400',
    })
    res.status(200).end(buf)
  }
}
