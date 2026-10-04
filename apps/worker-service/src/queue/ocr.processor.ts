import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { copyFile, unlink } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, ocrJobSchema, type OcrJob } from './job-schemas'
import { OCR_MAX_DIM, OcrService } from './ocr.service'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'

@Injectable()
export class OcrProcessor {
  private readonly logger = new Logger(OcrProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly ocr: OcrService,
  ) {}

  start() {
    this.bullMq.createWorker<OcrJob>('process-ocr', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('OCR processor listening for jobs')
  }

  private async processJob(job: Job<OcrJob>) {
    const { assetId, fileId, userId } = parseJobData(ocrJobSchema, job.data, 'process-ocr')

    this.logger.log(`Processing OCR: asset=${assetId}`)

    const record = await this.core.getFile(userId, fileId)
    const asset = await this.core.getAsset(userId, assetId)
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    const filePath = join(tmpdir(), `ocr-${randomUUID()}`)
    try {
      await copyFile(this.storage.pathFor(record.storageKey), filePath)

      // ponytail: receipts/scans need pixels — one EXIF-oriented pass down to OCR_MAX_DIM on the
      // long side (subsumes the 2048 face/embed prep; PaddleOCR downscales further itself)
      const resized = await sharp(filePath)
        .rotate()
        .resize({
          width: OCR_MAX_DIM,
          height: OCR_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer()

      const extracted = await this.ocr.extract(resized)
      if (!extracted) {
        // ponytail: no text or below the confidence floor — skip the register call entirely and
        // leave any previous row untouched (empty rows would only pollute the FTS index)
        this.logger.log(`OCR found no usable text: asset=${assetId}`)
        return
      }

      await this.core.registerOcr(userId, assetId, {
        text: extracted.text,
        // language detection is out of scope — the v6 model is multilingual, null is the honest value
        lang: null,
        confidence: extracted.confidence,
      })

      this.logger.log(`OCR complete: asset=${assetId}, chars=${extracted.text.length}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // ponytail: missing model weights are provisioning, not a job bug — warn + no retry.
      // No metadata status marker: core's UpdateMetadataDto has no ocrStatus field (sibling lane)
      if (message.includes('OCR model not found')) {
        this.logger.warn(`OCR skipped (missing model): asset=${assetId} — ${message}`)
        return
      }
      this.logger.error(`OCR failed: asset=${assetId} — ${message}`)
      throw err
    } finally {
      await unlink(filePath).catch(() => undefined)
    }
  }
}
