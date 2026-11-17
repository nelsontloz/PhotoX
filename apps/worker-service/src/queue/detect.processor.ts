import { Logger } from '@nestjs/common';
import { assetRefsJobSchema, bindingOf, type AssetRefsJob } from './job-schemas';
import { orientedPrep } from './asset-file-job';
import type { MediaProcessorSpec, ProcessorDeps } from './processor-spec';
import { scaleDetectionsToOriginal } from './detect.service';

// detection only needs scene-level objects, so a 1280px long side is plenty before the model's
// own 640px letterbox — the service records the geometry, not this prep
const DETECT_MAX_DIM = 1280;

export function detectProcessor({
  core,
  detect,
}: Pick<ProcessorDeps, 'core' | 'detect'>): MediaProcessorSpec<AssetRefsJob> {
  const logger = new Logger('DetectProcessor');

  return {
    queue: 'process-detect',
    job: {
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
        );

        const detections = await detect.detect(resized);
        const scaled = scaleDetectionsToOriginal(detections, scaleX, scaleY, origW, origH);

        // replace-semantics: core deletes the asset's whole row set and inserts this one, so an
        // empty array MUST be registered — that is what clears stale rows on a re-run
        await core.registerDetections(
          data.userId,
          data.assetId,
          { detections: scaled },
          bindingOf(data),
        );

        logger.log(`Detection complete: asset=${data.assetId}, count=${scaled.length}`);
      },
    },
  };
}
