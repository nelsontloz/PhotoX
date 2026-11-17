import { Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import sharp from 'sharp';
import { assetRefsJobSchema, bindingOf, type AssetRefsJob } from './job-schemas';
import { patchStatusFailed } from './asset-file-job';
import type { MediaProcessorSpec, ProcessorDeps } from './processor-spec';
import type { MetadataPatch } from '../core/core-client.service';
import type { ExtractedMetadata, VideoMetadataPatch } from './metadata.extractor';
import { computeDhash, DHASH_HEIGHT, DHASH_WIDTH } from './dhash';

export function branchFor(mimeType: string | null): 'photo' | 'video' | null {
  if (mimeType?.startsWith('image/')) return 'photo';
  if (mimeType?.startsWith('video/')) return 'video';
  return null;
}

export function metadataProcessor({
  core,
  metadataExtractor,
  videoMetadataExtractor,
}: Pick<
  ProcessorDeps,
  'core' | 'metadataExtractor' | 'videoMetadataExtractor'
>): MediaProcessorSpec<AssetRefsJob> {
  const logger = new Logger('MetadataProcessor');

  return {
    queue: 'process-metadata',
    job: {
      schema: assetRefsJobSchema,
      label: 'metadata',
      failureLabel: 'Metadata',
      onFailure: ({ userId, assetId, sig }) =>
        patchStatusFailed(core, logger, userId, assetId, { status: 'failed' }, sig),
      body: async ({ data, record, filePath }) => {
        const { assetId, userId } = data;
        const mimeType = record.mimeType ?? null;
        const sizeBytes = record.sizeBytes;
        const originalName = record.originalName ?? null;

        const branch = branchFor(mimeType);
        if (!branch) {
          logger.warn(`Unknown mime type ${mimeType}, skipping metadata: asset=${assetId}`);
          return;
        }

        let extracted: ExtractedMetadata | VideoMetadataPatch;
        // ponytail: dHash must never fail the metadata job — on error warn and OMIT the field
        // (a missing hash only costs dupe detection; a failed patch loses all metadata)
        let phash: string | null = null;
        if (branch === 'photo') {
          const photo = metadataExtractor.extract(await readFile(filePath));
          // EXIF iso can be rational (e.g. 201/2) — the DTO gates iso with @IsInt
          extracted = { ...photo, iso: photo.iso === null ? null : Math.round(photo.iso) };
          try {
            const grayscale = await sharp(filePath)
              .rotate()
              .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
              .grayscale()
              .raw()
              .toBuffer();
            phash = computeDhash(grayscale);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(`dHash failed: asset=${assetId} — ${message}`);
          }
        } else {
          extracted = await videoMetadataExtractor.extract(filePath);
        }

        // never send a null takenAt: the upload request may carry a client-supplied one that a
        // patch field would overwrite
        const { takenAt, ...fields } = extracted;
        const patch: MetadataPatch = {
          ...fields,
          status: Object.values(extracted).some((v) => v !== null) ? 'ready' : 'failed',
          ...(phash === null ? {} : { phash }),
          ...(takenAt === null ? {} : { takenAt }),
        };

        await core.patchMetadata(
          userId,
          assetId,
          { mimeType, sizeBytes, originalName, metadata: null, ...patch },
          bindingOf(data),
        );

        logger.log(`Metadata complete: asset=${assetId}`);
      },
    },
  };
}
