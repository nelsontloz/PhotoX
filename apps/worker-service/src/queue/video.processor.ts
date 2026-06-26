import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, rm, readdir, readFile, mkdir } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { runFfmpeg, runFfprobeJson, type FfprobeStream } from './ffmpeg'
import { HlsHttpClient } from '../storage/hls-http.client'

export interface ProcessVideoJob {
  assetId: string
  fileId: string
  userId: string
}

export interface AbrVariant {
  name: string
  width: number
  height: number
  vBitrate: string
  maxRate: string
  bufSize: string
}

export const ABR_LADDER: AbrVariant[] = [
  { name: '0', width: 1920, height: 1080, vBitrate: '4500k', maxRate: '5500k', bufSize: '11000k' },
  { name: '1', width: 1280, height: 720, vBitrate: '2800k', maxRate: '3500k', bufSize: '7000k' },
  { name: '2', width: 854, height: 480, vBitrate: '1400k', maxRate: '1800k', bufSize: '3600k' },
  { name: '3', width: 640, height: 360, vBitrate: '800k', maxRate: '1000k', bufSize: '2000k' },
  { name: '4', width: 426, height: 240, vBitrate: '400k', maxRate: '500k', bufSize: '1000k' },
]

const HLS_TIMEOUT_MS = 30 * 60 * 1000
const MAX_DURATION_SEC = 4 * 60 * 60
const MAX_DIMENSION = 7680

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/mp4',
  '.mp4': 'video/mp4',
}

function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export const HDR_TONEMAP_FILTER =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'

export function isHdrStream(stream: FfprobeStream | undefined): boolean {
  if (!stream) return false
  return (
    stream.color_primaries === 'bt2020' &&
    (stream.color_transfer === 'smpte2084' || stream.color_transfer === 'arib-std-b67')
  )
}

export function detectTranspose(stream: FfprobeStream | undefined): 0 | 1 | 2 | 3 {
  if (!stream) return 0
  const rotateTag = stream.tags?.rotate ? parseInt(stream.tags.rotate, 10) : NaN
  const sideDataRotation = stream.side_data_list?.[0]?.rotation
  const rotation = !isNaN(rotateTag)
    ? rotateTag
    : typeof sideDataRotation === 'number'
      ? sideDataRotation
      : 0
  if (rotation === 90) return 1
  if (rotation === 180) return 2
  if (rotation === 270) return 3
  return 0
}

export function buildAbrArgs(
  inputPath: string,
  outputDir: string,
  ladder: AbrVariant[],
  options?: { hdrFilter?: string; transpose?: 0 | 1 | 2 | 3; hasAudio?: boolean },
): string[] {
  const hasAudio = options?.hasAudio ?? false

  const scaleFilters: string[] = []
  for (let i = 0; i < ladder.length; i++) {
    const v = ladder[i]!
    scaleFilters.push(
      `[v${i + 1}]scale=w=${v.width}:h=${v.height}:force_original_aspect_ratio=decrease,pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2[v${i + 1}out]`,
    )
  }

  const preprocess: string[] = []
  if (options?.hdrFilter) preprocess.push(options.hdrFilter)
  if (options?.transpose) preprocess.push(`transpose=${options.transpose}`)

  const splits = ladder.map((_, i) => `[v${i + 1}]`).join('')
  const filterComplex =
    preprocess.length > 0
      ? `[0:v]${preprocess.join(',')},split=${ladder.length}${splits};${scaleFilters.join(';')}`
      : `[0:v]split=${ladder.length}${splits};${scaleFilters.join(';')}`

  const streamMap = ladder.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(' ')

  const args: string[] = [
    '-y',
    '-i',
    inputPath,
    '-filter_complex',
    filterComplex,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-x264-params',
    'keyint=48:min-keyint=48:no-scenecut=1',
    ...ladder.flatMap((v, i) => [
      '-map',
      `[v${i + 1}out]`,
      `-b:v:${i}`,
      v.vBitrate,
      `-maxrate:v:${i}`,
      v.maxRate,
      `-bufsize:v:${i}`,
      v.bufSize,
    ]),
  ]

  if (hasAudio) {
    ladder.forEach(() => {
      args.push('-map', '0:a:0')
    })
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2')
  }

  args.push(
    '-f',
    'hls',
    '-hls_time',
    '6',
    '-hls_playlist_type',
    'vod',
    '-hls_segment_type',
    'fmp4',
    '-master_pl_name',
    'master.m3u8',
    '-hls_segment_filename',
    `${outputDir}/%v/seg_%03d.m4s`,
    '-var_stream_map',
    streamMap,
    `${outputDir}/%v/playlist.m3u8`,
  )

  return args
}

@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly http: HttpService,
    private readonly hlsHttpClient: HlsHttpClient,
  ) {}

  start() {
    this.bullMq.createWorker<ProcessVideoJob>('process-video', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Video processor listening for jobs')
  }

  private async processJob(job: Job<ProcessVideoJob>) {
    const { assetId, fileId, userId } = job.data

    this.logger.log(`Processing video transcode: asset=${assetId}`)

    const srcDir = join(tmpdir(), `${fileId}`)
    const outDir = `${srcDir}-hls`

    try {
      await this.patchAsset(assetId, { transcodeStatus: 'pending' })

      const srcPath = await this.downloadSource(fileId, srcDir)

      const probe = await runFfprobeJson(srcPath)
      const duration = probe.format.duration ? Number.parseFloat(probe.format.duration) : 0
      const videoStream = probe.streams.find((s) => s.codec_type === 'video')
      const width = videoStream?.width ?? 0
      const height = videoStream?.height ?? 0
      const hasAudio = probe.streams.some((s) => s.codec_type === 'audio')

      if (duration > MAX_DURATION_SEC) {
        throw new Error(`Video duration ${duration}s exceeds ${MAX_DURATION_SEC}s limit`)
      }
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new Error(`Video dimensions ${width}x${height} exceed ${MAX_DIMENSION} limit`)
      }

      const ladder = ABR_LADDER.filter(
        (v) => v.height <= height || v === ABR_LADDER[ABR_LADDER.length - 1],
      )

      const isHdr = isHdrStream(videoStream)
      const transpose = detectTranspose(videoStream)
      this.logger.log(
        `Video ${fileId}: hdr=${isHdr}, rotation=${transpose === 1 ? 90 : transpose === 2 ? 180 : transpose === 3 ? 270 : 0}, audio=${hasAudio}, variants=${ladder.length}`,
      )

      const args = buildAbrArgs(srcPath, outDir, ladder, {
        hdrFilter: isHdr ? HDR_TONEMAP_FILTER : undefined,
        transpose,
        hasAudio,
      })
      await runFfmpeg(args, { timeoutMs: HLS_TIMEOUT_MS })

      const hlsFiles = (await readdir(outDir, { recursive: true })).filter((p) => p.includes('.'))
      const uploadBatch: { key: string; body: Buffer; contentType: string }[] = []
      for (const relPath of hlsFiles) {
        const absPath = join(outDir, relPath)
        const key = `${userId}/${fileId}/hls/${relPath}`
        const body = await readFile(absPath)
        uploadBatch.push({ key, body, contentType: getContentType(absPath) })
      }
      await this.hlsHttpClient.uploadBatch(userId, fileId, uploadBatch)

      const hlsMasterKey = `${userId}/${fileId}/hls/master.m3u8`
      await this.patchAsset(assetId, {
        transcodeStatus: 'ready',
        hlsMasterKey,
        transcodedAt: new Date().toISOString(),
      })

      this.logger.log(`Video transcode complete: asset=${assetId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Video transcode failed: asset=${assetId} — ${message}`)

      try {
        await this.patchAsset(assetId, {
          transcodeStatus: 'failed',
          metadata: { transcodeError: message },
        })
      } catch {
        this.logger.warn(`Failed to patch transcode error for asset=${assetId}`)
      }

      throw err
    } finally {
      try {
        await rm(srcDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
      try {
        await rm(outDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private async downloadSource(fileId: string, destDir: string): Promise<string> {
    const urlRes = await firstValueFrom(
      this.http.get<{ url: string }>(
        `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/url?ttl=600`,
        { timeout: 5_000 },
      ),
    )
    const presignedUrl = urlRes.data.url

    const fileRes = await firstValueFrom(
      this.http.get(presignedUrl, {
        responseType: 'arraybuffer',
        timeout: 300_000,
      }),
    )

    const buffer = Buffer.from(fileRes.data as ArrayBuffer)
    const contentType = (fileRes.headers['content-type'] as string) ?? 'video/mp4'
    const ext = contentType.includes('webm')
      ? 'webm'
      : contentType.includes('quicktime')
        ? 'mov'
        : 'mp4'
    const destPath = join(destDir, `source.${ext}`)
    await mkdir(destDir, { recursive: true })
    await writeFile(destPath, buffer)
    return destPath
  }

  private async patchAsset(assetId: string, patch: Record<string, unknown>): Promise<void> {
    const url = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
    await firstValueFrom(this.http.patch(url, patch, { timeout: 5_000 }))
  }
}
