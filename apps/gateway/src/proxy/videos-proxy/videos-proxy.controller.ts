import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'
import type { Asset } from '@photox/shared-types'
import { HlsProxyService } from './hls-proxy.service'
import { contentTypeFor } from '../../common/hls-content-types'

@ApiTags('videos')
@ApiBearerAuth()
@Controller('api/v1/videos')
export class VideosProxyController {
  constructor(
    private readonly http: HttpService,
    private readonly hls: HlsProxyService,
  ) {}

  @Get(':assetId/stream')
  @ApiOperation({ summary: 'Stream the original video file (authenticated)' })
  @ApiResponse({ status: 200, description: 'Video stream' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Asset does not belong to the authenticated user' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async streamVideo(@Param('assetId') assetId: string, @Req() req: Request, @Res() res: Response) {
    const userId = this.userId(req)
    const asset = await this.getAsset(assetId, userId)

    const stream = await this.hls.getOriginalFileStream(asset.fileId, userId)
    res.set({
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60',
    })
    stream.pipe(res)
  }

  @Get(':assetId/playlist.m3u8')
  @ApiOperation({ summary: 'Get the HLS master playlist (authenticated)' })
  @ApiResponse({ status: 200, description: 'Rewritten HLS master playlist' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Asset does not belong to the authenticated user' })
  @ApiResponse({ status: 404, description: 'Asset not found or not a video' })
  @ApiResponse({ status: 409, description: 'Transcoding failed' })
  @ApiResponse({ status: 425, description: 'Transcoding in progress' })
  async getPlaylist(@Param('assetId') assetId: string, @Req() req: Request, @Res() res: Response) {
    const userId = this.userId(req)
    const asset = await this.getAsset(assetId, userId)
    this.assertVideo(asset)
    if (this.assertTranscodeReady(res, asset)) return

    const playlist = await this.hls.fetchHls(asset.hlsMasterKey!, 'text')
    const rewritten = this.rewritePlaylistUrls(playlist, assetId)
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
    })
    res.status(200).send(rewritten)
  }

  @Get(':assetId/*')
  @ApiOperation({ summary: 'Get an HLS variant playlist or segment (authenticated)' })
  @ApiResponse({ status: 200, description: 'HLS asset bytes' })
  @ApiResponse({ status: 400, description: 'Invalid HLS path' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Asset does not belong to the authenticated user' })
  @ApiResponse({ status: 404, description: 'Asset not found or not a video' })
  @ApiResponse({ status: 409, description: 'Transcoding failed' })
  @ApiResponse({ status: 425, description: 'Transcoding in progress' })
  async getHlsAsset(@Param('assetId') assetId: string, @Req() req: Request, @Res() res: Response) {
    const rawPath = (req.params[0] ?? '').replace(/^\/+/, '')
    if (!rawPath) {
      throw new NotFoundException('HLS path is empty')
    }
    const safePath = this.sanitizeHlsPath(rawPath)

    const userId = this.userId(req)
    const asset = await this.getAsset(assetId, userId)
    this.assertVideo(asset)
    if (this.assertTranscodeReady(res, asset)) return

    const masterDir = asset.hlsMasterKey!.slice(0, asset.hlsMasterKey!.lastIndexOf('/'))
    const key = `${masterDir}/${safePath}`
    const stream = await this.hls.fetchHls(key, 'stream')
    res.set({
      'Content-Type': contentTypeFor(safePath),
      'Cache-Control': 'no-store',
    })
    stream.pipe(res)
  }

  private userId(req: Request): string {
    const user = req.user as { id?: string }
    if (!user?.id) {
      throw new NotFoundException('Authenticated user not found on request')
    }
    return user.id
  }

  private async getAsset(assetId: string, userId: string): Promise<Asset> {
    let asset: Asset
    try {
      const assetRes = await firstValueFrom(
        this.http.get<Asset>(`${SERVICE_URLS['media-service']}/v1/assets/${assetId}`, {
          params: { userId },
          timeout: 5_000,
        }),
      )
      asset = assetRes.data
    } catch {
      throw new ForbiddenException('Asset not accessible to the authenticated user')
    }

    if (asset.userId !== userId) {
      throw new ForbiddenException('Asset does not belong to the authenticated user')
    }

    return asset
  }

  private assertVideo(asset: Asset): void {
    if (asset.kind !== 'video') {
      throw new NotFoundException('Asset is not a video')
    }
  }

  private assertTranscodeReady(res: Response, asset: Asset): boolean {
    if (asset.transcodeStatus === 'pending') {
      res.status(425).json({ status: 'pending', message: 'Transcoding in progress' })
      return true
    }
    if (asset.transcodeStatus === 'failed') {
      res.status(409).json({ status: 'failed', message: 'Transcoding failed' })
      return true
    }
    if (!asset.hlsMasterKey) {
      res.status(500).json({ status: 'error', message: 'HLS master key missing' })
      return true
    }
    return false
  }

  private rewritePlaylistUrls(playlist: string, assetId: string): string {
    return playlist
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || trimmed.includes('://')) {
          return line
        }
        if (trimmed.includes('?')) {
          const [path, query] = trimmed.split('?')
          return `/api/v1/videos/${assetId}/${path}?${query}`
        }
        return `/api/v1/videos/${assetId}/${trimmed}`
      })
      .join('\n')
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
}
