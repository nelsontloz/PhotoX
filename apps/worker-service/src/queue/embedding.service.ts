import { Injectable, Logger } from '@nestjs/common'
import { join } from 'path'
import { loadEnv } from '@photox/shared-config'
import { SEARCH_EMBEDDING_MODEL, toEmbedding } from '@photox/shared-types'
import { lazyOnce, requireModelFile } from './model-loader'
import type { ImageFeatureExtractionPipeline } from '@huggingface/transformers'

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)
  private readonly load = lazyOnce(() => this.createPipeline())

  modelDir(): string {
    return join(loadEnv().STORAGE_DIR, 'models', SEARCH_EMBEDDING_MODEL)
  }

  private async createPipeline(): Promise<ImageFeatureExtractionPipeline> {
    // ponytail: lazy import so unit tests (and any host without the native ORT binding) never
    // dlopen the inference stack — same reason FaceEmbedderService lazy-loads onnxruntime-node
    const { pipeline, env } = await import('@huggingface/transformers')
    const modelDir = this.modelDir()
    await requireModelFile(
      join(modelDir, 'config.json'),
      `Vision embedding model not found at ${modelDir} — run ` +
        `'pnpm --filter @photox/worker-service vision-model'`,
    )

    // offline-only: weights come from disk, the process never talks to the HF hub at runtime
    env.localModelPath = join(loadEnv().STORAGE_DIR, 'models')
    env.allowRemoteModels = false

    // ponytail: transformers 4.3.0 has no SigLIP2-specific classes — this works only because the
    // onnx-community export shims model_type 'siglip', so the task mapping resolves the v1
    // SiglipVisionModel. Verify class selection if the model repo or transformers major changes.
    const pipe = await pipeline('image-feature-extraction', SEARCH_EMBEDDING_MODEL, {
      dtype: 'int8',
      // ponytail: 2 ORT threads instead of the all-cores default — SCRFD/ArcFace sessions are
      // co-hosted in this process; raise (env knob) only if embedding throughput starves queues
      session_options: { intraOpNumThreads: 2 },
    })
    this.logger.log(`Vision embedder loaded: ${modelDir}`)
    return pipe
  }

  async embed(image: Buffer): Promise<number[]> {
    const pipe = await this.load()
    const { RawImage } = await import('@huggingface/transformers')
    const raw = await RawImage.fromBlob(new Blob([image], { type: 'image/jpeg' }))
    // pool: true returns SigLIP's MAP-head image embedding (768-d), not patch hidden states —
    // the same pooled space P3's text encoder produces
    const output = await pipe(raw, { pool: true })
    return toEmbedding(output.data as Float32Array)
  }
}
