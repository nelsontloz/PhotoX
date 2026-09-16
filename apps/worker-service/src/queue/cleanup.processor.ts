import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { FileRecord, LocalStorageService } from '@photox/data-access'

interface CleanupJob {
  fileId: string
}

@Injectable()
export class CleanupProcessor {
  private readonly logger = new Logger(CleanupProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly storage: LocalStorageService,
  ) {}

  start() {
    this.bullMq.createWorker<CleanupJob>('cleanup-asset', (job) => this.processJob(job), {
      concurrency: 5,
    })

    this.logger.log('Cleanup processor listening for jobs')
  }

  private async processJob(job: Job<CleanupJob>) {
    const { fileId } = job.data

    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) return
    try {
      await this.storage.delete(record.storageKey)
    } catch (err) {
      this.logger.error(
        `Storage delete failed for ${fileId}`,
        err instanceof Error ? err.stack : undefined,
      )
    }
    await this.fileRepo.remove(record)
  }
}
