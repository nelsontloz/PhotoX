import { Logger } from '@nestjs/common';
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import { assetRefsJobSchema, bindingOf, type AssetRefsJob } from './job-schemas';
import { orientedPrep, patchStatusFailed } from './asset-file-job';
import type { MediaProcessorSpec, ProcessorDeps } from './processor-spec';
import { FACE_MAX_DIM } from './face.processor';

export function embeddingProcessor({
  core,
  embedder,
}: Pick<ProcessorDeps, 'core' | 'embedder'>): MediaProcessorSpec<AssetRefsJob> {
  const logger = new Logger('EmbeddingProcessor');

  return {
    queue: 'process-embeddings',
    job: {
      schema: assetRefsJobSchema,
      label: 'Embedding',
      missingModelMarkers: ['Vision embedding model not found'],
      onFailure: ({ userId, assetId, sig }) =>
        patchStatusFailed(core, logger, userId, assetId, { embeddingStatus: 'failed' }, sig),
      body: async ({ data, filePath }) => {
        // ponytail: same EXIF-oriented ≤2048px prep as face detection — the SigLIP processor
        // downscales to 224 itself; 2048 keeps texture detail without decoding full resolution
        const { resized } = await orientedPrep(filePath, FACE_MAX_DIM);

        const embedding = await embedder.embed(resized);
        await core.registerEmbedding(
          data.userId,
          data.assetId,
          {
            kind: 'image',
            model: SEARCH_EMBEDDING_MODEL,
            embedding,
          },
          bindingOf(data),
        );

        logger.log(`Embedding complete: asset=${data.assetId}`);
      },
    },
  };
}
