import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Req,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS, loadEnv } from '@photox/shared-config'
import type { Asset } from '@photox/shared-types'
import { Public } from '../../auth/public.decorator'

@ApiTags('videos')
@Controller('api/v1/videos')
export class VideosProxyController {
  constructor(private readonly http: HttpService) {}

  @Get(':assetId/stream')
  @Public()
  @ApiOperation({ summary: 'Get a redirect to a presigned video URL' })
  @ApiResponse({ status: 302, description: 'Redirect to presigned URL' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async streamVideo(
    @Param('assetId') assetId: string,
    @Query('ttl') ttl: string | undefined,
    @Res() res: Response,
  ) {
    const asset = await this.getAsset(assetId)

    const fileId = asset.fileId
    const query = ttl ? `?ttl=${encodeURIComponent(ttl)}` : ''
    const urlRes = await firstValueFrom(
      this.http.get<{ url: string; expiresAt: number }>(
        `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/url${query}`,
        { timeout: 5_000 },
      ),
    )

    const { url } = urlRes.data
    res.redirect(302, url)
  }

  @Get(':assetId/playlist.m3u8')
  @Public()
  @ApiOperation({ summary: 'Get a redirect to the HLS master playlist' })
  @ApiResponse({ status: 302, description: 'Redirect to HLS playlist URL' })
  @ApiResponse({ status: 404, description: 'Asset not found or not a video' })
  @ApiResponse({ status: 409, description: 'Transcoding failed' })
  @ApiResponse({ status: 425, description: 'Transcoding in progress' })
  async getPlaylist(@Param('assetId') assetId: string, @Res() res: Response) {
    const asset = await this.getAsset(assetId)

    if (asset.kind !== 'video') {
      throw new NotFoundException('Asset is not a video')
    }

    if (asset.transcodeStatus === 'pending') {
      res.status(425).json({ status: 'pending', message: 'Transcoding in progress' })
      return
    }

    if (asset.transcodeStatus === 'failed') {
      res.status(409).json({ status: 'failed', message: 'Transcoding failed' })
      return
    }

    if (!asset.hlsMasterKey) {
      res.status(500).json({ status: 'error', message: 'HLS master key missing' })
      return
    }

    const env = loadEnv()
    const url = `${env.MINIO_PUBLIC_ENDPOINT}/${env.MINIO_BUCKET}/${asset.hlsMasterKey}`
    res.redirect(302, url)
  }

  @Get(':assetId/*')
  @Public()
  @ApiOperation({ summary: 'Get a redirect to an HLS variant playlist or segment' })
  @ApiResponse({ status: 302, description: 'Redirect to the HLS asset path in MinIO' })
  @ApiResponse({ status: 400, description: 'Invalid HLS path' })
  @ApiResponse({ status: 404, description: 'Asset not found or not a video' })
  @ApiResponse({ status: 409, description: 'Transcoding failed' })
  @ApiResponse({ status: 425, description: 'Transcoding in progress' })
  async getHlsAsset(@Param('assetId') assetId: string, @Req() req: Request, @Res() res: Response) {
    const rawPath = (req.params[0] ?? '').replace(/^\/+/, '')
    if (!rawPath) {
      throw new NotFoundException('HLS path is empty')
    }
    const safePath = this.sanitizeHlsPath(rawPath)

    const asset = await this.getAsset(assetId)

    if (asset.kind !== 'video') {
      throw new NotFoundException('Asset is not a video')
    }

    if (asset.transcodeStatus === 'pending') {
      res.status(425).json({ status: 'pending', message: 'Transcoding in progress' })
      return
    }

    if (asset.transcodeStatus === 'failed') {
      res.status(409).json({ status: 'failed', message: 'Transcoding failed' })
      return
    }

    if (!asset.hlsMasterKey) {
      res.status(500).json({ status: 'error', message: 'HLS master key missing' })
      return
    }

    const env = loadEnv()
    const masterDir = asset.hlsMasterKey.slice(0, asset.hlsMasterKey.lastIndexOf('/'))
    const url = `${env.MINIO_PUBLIC_ENDPOINT}/${env.MINIO_BUCKET}/${masterDir}/${safePath}`
    res.redirect(302, url)
  }

  private sanitizeHlsPath(rawPath: string): string {
    const segments = rawPath.split('/').map((s) => {
      const decoded = decodeURIComponent(s)
      if (
        !decoded ||
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('\0') ||
        decoded.includes('\\')
      ) {
        throw new BadRequestException('Invalid HLS path')
      }
      return encodeURIComponent(decoded)
    })
    if (segments.length === 0) {
      throw new BadRequestException('Invalid HLS path')
    }
    return segments.join('/')
  }

  private async getAsset(assetId: string): Promise<Asset> {
    let asset: Asset
    try {
      const assetRes = await firstValueFrom(
        this.http.get<Asset>(`${SERVICE_URLS['media-service']}/v1/assets/${assetId}`, {
          timeout: 5_000,
        }),
      )
      asset = assetRes.data
    } catch {
      throw new NotFoundException('Asset not found')
    }

    if (!asset) {
      throw new NotFoundException('Asset not found')
    }

    return asset
  }
}
