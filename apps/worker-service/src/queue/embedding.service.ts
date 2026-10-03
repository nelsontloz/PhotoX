import { Injectable, Logger } from '@nestjs/common'
import { access } from 'fs/promises'
import { join } from 'path'
import { loadEnv } from '@photox/shared-config'
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import type { ImageFeatureExtractionPipeline } from '@huggingface/transformers'
import { l2Normalize } from './face.embedder'

// ponytail: int8 SigLIP2-B/16-224 ONNX weights are provisioned by
// `pnpm --filter @photox/worker-service vision-model` into STORAGE_DIR/models/<model id>/ —
// offline-only at runtime, never committed.
export function toEmbedding(raw: ArrayLike<number>): number[] {
  const vec = Array.from(raw)
  if (vec.length !== SEARCH_EMBEDDING_DIM) {
    throw new Error(
      `Unexpected vision embedding dim ${vec.length}, expected ${SEARCH_EMBEDDING_DIM}`,
    )
  }
  // L2-normalized so ANN dot product == cosine similarity (matches P3 text encoding)
  return l2Normalize(vec)
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)
  private pipelinePromise: Promise<ImageFeatureExtractionPipeline> | null = null

  modelDir(): string {
    return join(loadEnv().STORAGE_DIR, 'models', SEARCH_EMBEDDING_MODEL)
  }

  private load(): Promise<ImageFeatureExtractionPipeline> {
    this.pipelinePromise ??= this.createPipeline()
    return this.pipelinePromise
  }

  private async createPipeline(): Promise<ImageFeatureExtractionPipeline> {
    // ponytail: lazy import so unit tests (and any host without the native ORT binding) never
    // dlopen the inference stack — same reason FaceEmbedderService lazy-loads onnxruntime-node
    const { pipeline, env } = await import('@huggingface/transformers')
    const modelDir = this.modelDir()
    try {
      await access(join(modelDir, 'config.json'))
    } catch {
      throw new Error(
        `Vision embedding model not found at ${modelDir} — run ` +
          `'pnpm --filter @photox/worker-service vision-model'`,
      )
    }

    // offline-only: weights come from disk, the process never talks to the HF hub at runtime
    env.localModelPath = join(loadEnv().STORAGE_DIR, 'models')
    env.allowRemoteModels = false

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
