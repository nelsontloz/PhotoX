import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { assetRefsJobSchema, type AssetRefsJob } from './job-schemas'
import { orientedPrep, runAssetFileJob } from './asset-file-job'
import { DetectService, scaleDetectionsToOriginal } from './detect.service'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'

// detection only needs scene-level objects, so a 1280px long side is plenty before the model's
// own 640px letterbox — the service records the geometry, not this prep
const DETECT_MAX_DIM = 1280

@Injectable()
export class DetectProcessor implements OnModuleInit {
  private readonly logger = new Logger(DetectProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly detect: DetectService,
  ) {}

  onModuleInit() {
    this.bullMq.createWorker<AssetRefsJob>('process-detect', (job) => this.processJob(job))

    this.logger.log('Detection processor listening for jobs')
  }

  private async processJob(job: Job<AssetRefsJob>) {
    await runAssetFileJob({ core: this.core, storage: this.storage, logger: this.logger }, job, {
      queue: 'process-detect',
      schema: assetRefsJobSchema,
      label: 'Detection',
      // ponytail: missing model weights are provisioning, not a job bug — warn + no retry.
      // No metadata status marker: core's UpdateMetadataDto has no detection status field
      missingModelMarkers: ['Detection model not found'],
      body: async ({ data, filePath }) => {
        // ponytail: EXIF-oriented ≤1280px long side — the model's own letterbox goes to 640, then
        // scaleDetectionsToOriginal maps boxes from this prep space back to ORIGINAL px below
        const { resized, scaleX, scaleY, origW, origH } = await orientedPrep(
          filePath,
          DETECT_MAX_DIM,
        )

        const detections = await this.detect.detect(resized)
        const scaled = scaleDetectionsToOriginal(detections, scaleX, scaleY, origW, origH)

        // replace-semantics: core deletes the asset's whole row set and inserts this one, so an
        // empty array MUST be registered — that is what clears stale rows on a re-run
        await this.core.registerDetections(
          data.userId,
          data.assetId,
          { detections: scaled },
          data.sig === undefined ? undefined : { sig: data.sig },
        )

        this.logger.log(`Detection complete: asset=${data.assetId}, count=${scaled.length}`)
      },
    })
  }
}
