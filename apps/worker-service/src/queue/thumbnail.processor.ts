import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import sharp from 'sharp'
import { type Job } from 'pg-boss'
import { PgBossService } from './pg-boss.service'
import { JobRecord, JobStatus } from './entities/job.entity'
import type { ProcessThumbnailDto } from './dto/process-thumbnail.dto'

interface ThumbnailJob {
  assetId: string
  fileId: string
  size: string
}

@Injectable()
export class ThumbnailProcessor {
  private readonly logger = new Logger(ThumbnailProcessor.name)

  constructor(
    private readonly pgBoss: PgBossService,
    @InjectRepository(JobRecord)
    private readonly jobRepo: Repository<JobRecord>,
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
    const { assetId, fileId, size } = job.data

    this.logger.log(`Processing thumbnail: asset=${assetId}, size=${size}`)

    await this.jobRepo.update({ assetId, size }, { status: JobStatus.PROCESSING })

    try {
      await this.generateThumbnail(fileId, size)

      await this.jobRepo.update({ assetId, size }, { status: JobStatus.COMPLETED })

      this.logger.log(`Thumbnail complete: asset=${assetId}, size=${size}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Thumbnail failed: asset=${assetId}, size=${size} — ${message}`)

      await this.jobRepo.update({ assetId, size }, { status: JobStatus.FAILED, error: message })

      throw err
    }
  }

  private async generateThumbnail(_fileId: string, size: string): Promise<void> {
    const [width, height] = size.split('x').map(Number)

    // TODO: Fetch original file from file-storage-service
    // For now, stub: create a minimal placeholder thumbnail
    const buffer = await sharp({
      create: {
        width: width || 150,
        height: height || 150,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer()

    // TODO: Upload thumbnail to file-storage-service
    // TODO: Register thumbnail metadata via media-service internal API
    void buffer
  }
}
