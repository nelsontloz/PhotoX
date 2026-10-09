import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { ocrJobSchema, type OcrJob } from './job-schemas'
import { runAssetFileJob } from './asset-file-job'
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
    this.bullMq.createWorker<OcrJob>('process-ocr', (job) => this.processJob(job))

    this.logger.log('OCR processor listening for jobs')
  }

  private async processJob(job: Job<OcrJob>) {
    await runAssetFileJob({ core: this.core, storage: this.storage, logger: this.logger }, job, {
      queue: 'process-ocr',
      schema: ocrJobSchema,
      label: 'OCR',
      // ponytail: missing model weights are provisioning, not a job bug — warn + no retry.
      // No metadata status marker: core's UpdateMetadataDto has no ocrStatus field
      missingModelMarkers: ['OCR model not found'],
      body: async ({ data, filePath }) => {
        // ponytail: receipts/scans need pixels — one EXIF-oriented pass down to OCR_MAX_DIM on
        // the long side (subsumes the 2048 face/embed prep; PaddleOCR downscales further itself)
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
          // ponytail: no text or below the confidence floor — skip the register call entirely
          // and leave any previous row untouched (empty rows would only pollute the FTS index)
          this.logger.log(`OCR found no usable text: asset=${data.assetId}`)
          return
        }

        await this.core.registerOcr(data.userId, data.assetId, {
          text: extracted.text,
          // language detection is out of scope — the v6 model is multilingual, null is the honest value
          lang: null,
          confidence: extracted.confidence,
        })

        this.logger.log(`OCR complete: asset=${data.assetId}, chars=${extracted.text.length}`)
      },
    })
  }
}
