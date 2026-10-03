import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { loadEnv } from '@photox/shared-config'
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL, toEmbedding } from '@photox/shared-types'
import type { Tensor } from '@huggingface/transformers'
import { EmbeddingService } from '../../src/queue/embedding.service'

const modelDir = join(loadEnv().STORAGE_DIR, 'models', SEARCH_EMBEDDING_MODEL)
const modelsPresent =
  existsSync(join(modelDir, 'config.json')) &&
  existsSync(join(modelDir, 'onnx', 'vision_model_int8.onnx')) &&
  existsSync(join(modelDir, 'onnx', 'text_model_int8.onnx'))

// real ONNX session load + run, skipped when the int8 weights are absent (provision with
// `pnpm --filter @photox/worker-service vision-model`); never downloads anything
describe.skipIf(!modelsPresent)('SigLIP2 cross-modal smoke', () => {
  it('ranks the matching caption above mismatches', async () => {
    const { AutoTokenizer, SiglipTextModel, env } = await import('@huggingface/transformers')
    env.localModelPath = join(loadEnv().STORAGE_DIR, 'models')
    env.allowRemoteModels = false

    const embedder = new EmbeddingService()
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
        '<rect width="512" height="512" fill="white"/>' +
        '<rect x="106" y="106" width="300" height="300" fill="red"/></svg>',
    )
    const imageVec = await embedder.embed(await sharp(svg).jpeg().toBuffer())

    // P3 text encoding — copy exactly this call (core side):
    //   const { AutoTokenizer, SiglipTextModel, env } = await import('@huggingface/transformers')
    //   env.localModelPath = join(STORAGE_DIR, 'models'); env.allowRemoteModels = false
    //   const tokenizer = await AutoTokenizer.from_pretrained(SEARCH_EMBEDDING_MODEL)
    //   const textModel = await SiglipTextModel.from_pretrained(SEARCH_EMBEDDING_MODEL, {
    //     dtype: 'int8', session_options: { intraOpNumThreads: 2 },
    //   })
    //   const outputs = await textModel(tokenizer(texts, { padding: true, truncation: true }))
    //   toEmbedding(outputs.pooler_output.data)  // learned head, NOT a mean/CLS pool
    const tokenizer = await AutoTokenizer.from_pretrained(SEARCH_EMBEDDING_MODEL)
    const textModel = await SiglipTextModel.from_pretrained(SEARCH_EMBEDDING_MODEL, {
      dtype: 'int8',
      session_options: { intraOpNumThreads: 2 },
    })

    const captions = ['a solid red square', 'a photograph of a cat', 'a snowy mountain landscape']
    const outputs = (await textModel(
      tokenizer(captions, { padding: true, truncation: true }),
    )) as Record<string, Tensor>
    const pooled = outputs.pooler_output!.data as Float32Array
    const textVecs = captions.map((_, i) =>
      toEmbedding(pooled.subarray(i * SEARCH_EMBEDDING_DIM, (i + 1) * SEARCH_EMBEDDING_DIM)),
    )

    // both sides are L2-normalized by toEmbedding, so the dot product is cosine similarity
    const cosine = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0)
    const match = cosine(imageVec, textVecs[0]!)
    const bestMismatch = Math.max(cosine(imageVec, textVecs[1]!), cosine(imageVec, textVecs[2]!))

    expect(match - bestMismatch).toBeGreaterThan(0.02)
  }, 120_000)
})
