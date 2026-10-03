import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { access } from 'fs/promises'
import { join } from 'path'
import { loadEnv } from '@photox/shared-config'
import { SEARCH_EMBEDDING_MODEL, SEARCH_TEXT_MAX_LENGTH, toEmbedding } from '@photox/shared-types'
import type { PreTrainedTokenizer, SiglipTextModel } from '@huggingface/transformers'

const CACHE_MAX = 256
const PROVISION_CMD = 'pnpm --filter @photox/worker-service vision-model'

interface TextTower {
  tokenizer: PreTrainedTokenizer
  model: SiglipTextModel
}

@Injectable()
export class TextEncodeService {
  private towerPromise: Promise<TextTower> | null = null
  // ponytail: tiny in-process LRU (Map insertion order) — a search bar repeats queries far more
  // than it explores; 256 entries ≈ 0.8MB of vectors. Drop for Redis if multi-instance ever lands.
  private readonly cache = new Map<string, number[]>()

  async encode(query: string): Promise<number[]> {
    const key = query.trim()
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    const vector = await this.encodeUncached(key)
    this.cache.set(key, vector)
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return vector
  }

  // split out so unit tests can exercise the LRU without loading ONNX
  protected async encodeUncached(query: string): Promise<number[]> {
    const { tokenizer, model } = await this.load()
    // exactly the smoke-spec call: SiglipTextModel's learned pooler_output, NOT feature-extraction
    // mean/CLS pooling (cross-modal contract in shared-types). padding='max_length' is load-bearing:
    // the tower pools the last slot of the 64-token padded sequence it was trained on.
    const outputs = (await model(
      tokenizer([query], {
        padding: 'max_length',
        max_length: SEARCH_TEXT_MAX_LENGTH,
        truncation: true,
      }),
    )) as {
      pooler_output?: { data: Float32Array }
    }
    if (!outputs.pooler_output) throw new Error('SiglipTextModel returned no pooler_output')
    return toEmbedding(outputs.pooler_output.data)
  }

  private async load(): Promise<TextTower> {
    this.towerPromise ??= this.createTower()
    try {
      return await this.towerPromise
    } catch (err) {
      this.towerPromise = null
      throw err
    }
  }

  private async createTower(): Promise<TextTower> {
    const modelsRoot = join(loadEnv().STORAGE_DIR, 'models')
    const modelDir = join(modelsRoot, SEARCH_EMBEDDING_MODEL)
    try {
      await access(join(modelDir, 'onnx', 'text_model_int8.onnx'))
    } catch {
      throw new ServiceUnavailableException(
        `Vision search model not provisioned at ${modelDir} — run '${PROVISION_CMD}' on the host, ` +
          `then POST /api/v1/admin/embeddings/reprocess`,
      )
    }

    // lazy import: hosts without the native ORT binding (or without the model) never dlopen the stack
    const { AutoTokenizer, SiglipTextModel, env } = await import('@huggingface/transformers')
    env.localModelPath = modelsRoot
    env.allowRemoteModels = false
    const tokenizer = await AutoTokenizer.from_pretrained(SEARCH_EMBEDDING_MODEL)
    const model = await SiglipTextModel.from_pretrained(SEARCH_EMBEDDING_MODEL, {
      dtype: 'int8',
      // ponytail: 2 ORT threads, matching the worker's vision embedder — raise if search latency
      // starves the process
      session_options: { intraOpNumThreads: 2 },
    })
    return { tokenizer, model }
  }
}
