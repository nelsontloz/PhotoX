import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { loadEnv } from '@photox/shared-config'
import { OCR_MODEL_DIR, OcrService } from '../../src/queue/ocr.service'

const modelDir = join(loadEnv().STORAGE_DIR, 'models', OCR_MODEL_DIR)
const modelsPresent =
  existsSync(join(modelDir, 'det.onnx')) &&
  existsSync(join(modelDir, 'rec.onnx')) &&
  existsSync(join(modelDir, 'dict.txt'))

// real ONNX session load + run, skipped when the PP-OCRv6 small weights are absent (provision with
// `pnpm --filter @photox/worker-service ocr-model`); never downloads anything
describe.skipIf(!modelsPresent)('PP-OCRv6 smoke', () => {
  it('extracts text from a rendered text image', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="260">' +
        '<rect width="1000" height="260" fill="white"/>' +
        '<text x="500" y="160" font-family="sans-serif" font-size="110" font-weight="bold" ' +
        'text-anchor="middle" fill="black">TOTAL 42.50</text></svg>',
    )
    const image = await sharp(svg).png().toBuffer()

    const extracted = await new OcrService().extract(image)

    expect(extracted).not.toBeNull()
    expect(extracted!.text.length).toBeGreaterThan(0)
  }, 120_000)
})
