import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import sharp from 'sharp'
import { firstValueFrom } from 'rxjs'
import FormData from 'form-data'
import { type Job } from 'pg-boss'
import { PgBossService } from './pg-boss.service'
import { JobRecord, JobStatus } from './entities/job.entity'
import type { ProcessThumbnailDto } from './dto/process-thumbnail.dto'
import { SERVICE_URLS } from '@photox/shared-config'

const STANDARD_SIZES: Record<string, [number, number]> = {
  sm: [150, 150],
  md: [300, 300],
  lg: [600, 600],
  xl: [1920, 1920],
}

const RESIZE_OPTIONS: Record<string, sharp.ResizeOptions> = {
  sm: { fit: 'cover' },
  md: { fit: 'cover' },
  lg: { fit: 'cover' },
  xl: { fit: 'inside' },
}

const WEBP_QUALITY: Record<string, number> = {
  sm: 80,
  md: 80,
  lg: 80,
  xl: 85,
}

interface ThumbnailJob {
  assetId: string
  fileId: string
  size: string
  userId: string
}

@Injectable()
export class ThumbnailProcessor {
  private readonly logger = new Logger(ThumbnailProcessor.name)

  constructor(
    private readonly pgBoss: PgBossService,
    @InjectRepository(JobRecord)
    private readonly jobRepo: Repository<JobRecord>,
    private readonly http: HttpService,
  ) {}

  async enqueue(dto: ProcessThumbnailDto): Promise<{ jobId: string; status: string }> {
    const existing = await this.jobRepo.findOne({
      where: { assetId: dto.assetId, size: dto.size, status: JobStatus.QUEUED },
    })

    if (existing) {
      return { jobId: existing.id, status: existing.status }
    }

    const record = this.jobRepo.create({
      assetId: dto.assetId,
      fileId: dto.fileId,
      size: dto.size,
      status: JobStatus.QUEUED,
    })
    await this.jobRepo.save(record)

    const jobId = await this.pgBoss.send('process-thumbnail', {
      assetId: dto.assetId,
      fileId: dto.fileId,
      size: dto.size,
      userId: dto.userId,
    })

    return { jobId: jobId ?? record.id, status: JobStatus.QUEUED }
  }

  async start() {
    await this.pgBoss.createQueue('process-thumbnail')
    await this.pgBoss.work<ThumbnailJob>('process-thumbnail', async (jobs) => {
      for (const job of jobs) {
        await this.processJob(job)
      }
    })

    this.logger.log('Thumbnail processor listening for jobs')
  }

  private async processJob(job: Job<ThumbnailJob>) {
    const { assetId, fileId, size, userId } = job.data

    this.logger.log(`Processing thumbnail: asset=${assetId}, size=${size}`)

    await this.jobRepo.update({ assetId, size }, { status: JobStatus.PROCESSING })

    try {
      await this.generateThumbnail(fileId, assetId, size, userId)

      await this.jobRepo.update({ assetId, size }, { status: JobStatus.COMPLETED })

      this.logger.log(`Thumbnail complete: asset=${assetId}, size=${size}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Thumbnail failed: asset=${assetId}, size=${size} — ${message}`)

      await this.jobRepo.update({ assetId, size }, { status: JobStatus.FAILED, error: message })

      throw err
    }
  }

  private async generateThumbnail(
    fileId: string,
    assetId: string,
    size: string,
    userId: string,
  ): Promise<void> {
    const dims = STANDARD_SIZES[size]
    const [width, height] = dims ?? size.split('x').map(Number)

    const streamUrl = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/stream`
    const upstream = await firstValueFrom(
      this.http.get(streamUrl, { responseType: 'arraybuffer', timeout: 30_000 }),
    )
    const buffer = Buffer.from(upstream.data as ArrayBuffer)

    const { data: thumbBuffer, info } = await sharp(buffer)
      .resize(width, height, RESIZE_OPTIONS[size] ?? { fit: 'cover' })
      .webp({ quality: WEBP_QUALITY[size] ?? 80 })
      .toBuffer({ resolveWithObject: true })

    const uploadUrl = `${SERVICE_URLS['file-storage-service']}/v1/files`
    const form = new FormData()
    form.append('file', thumbBuffer, {
      filename: `thumb-${size}.webp`,
      contentType: 'image/webp',
    })
    form.append('userId', userId)

    const uploadRes = await firstValueFrom(
      this.http.post(uploadUrl, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }),
    )
    const newFileRecord = uploadRes.data as { id: string }

    const registerUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/thumbnails`
    await firstValueFrom(
      this.http.post(registerUrl, {
        size,
        fileId: newFileRecord.id,
        width: info.width,
        height: info.height,
        bytes: thumbBuffer.length,
      }),
    )
  }
}
