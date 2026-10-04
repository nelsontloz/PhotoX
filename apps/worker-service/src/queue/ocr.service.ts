import { Injectable, Logger } from '@nestjs/common'
import { access } from 'fs/promises'
import { join } from 'path'
import { loadEnv } from '@photox/shared-config'
import type { PaddleOcrService } from 'ppu-paddle-ocr'

// ponytail: PP-OCRv6 small (det ~10MB + rec ~21MB + dict) provisioned by
// `pnpm --filter @photox/worker-service ocr-model` into STORAGE_DIR/models/<dir>/ — offline-only
// at runtime, never committed.
export const OCR_MODEL_DIR = 'pp-ocrv6-small'

// ponytail: receipts need pixels, so the long side is capped at 1600 — PaddleOCR's own "auto"
// cap would shrink large photos harder; 1600 keeps small print readable at ~31MB model cost
export const OCR_MAX_DIM = 1600

// ponytail: per-item drop_score handed to PaddleOCR's recognition (upstream convention: noise
// reads 0.2-0.45, real text 0.65+), NOT a per-line filter — the library drops sub-threshold items
// before we ever see them. Upgrade: tune once a corpus shows false positives/negatives.
export const OCR_MIN_CONFIDENCE = 0.5

export interface OcrExtract {
  text: string
  confidence: number
}

// pure: normalize the library's concatenated text (one detected line per '\n'), trim/drop blank
// lines. The confidence floor is per item inside ppu-paddle-ocr, so this only rejects empty
// output; the surviving mean confidence is carried through for the register payload.
export function finalizeOcrText(text: string, confidence: number): OcrExtract | null {
  const normalized = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
  if (normalized.length === 0) return null
  return { text: normalized, confidence }
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name)
  private servicePromise: Promise<PaddleOcrService> | null = null

  modelDir(): string {
    return join(loadEnv().STORAGE_DIR, 'models', OCR_MODEL_DIR)
  }

  private load(): Promise<PaddleOcrService> {
    // ponytail: reset on rejection — the first jobs can run before ocr-model is provisioned and
    // must not poison every later job until a worker restart (same F3 pattern as EmbeddingService)
    this.servicePromise ??= this.createService().catch((err: unknown) => {
      this.servicePromise = null
      throw err
    })
    return this.servicePromise
  }

  private async createService(): Promise<PaddleOcrService> {
    // ponytail: lazy import so unit tests (and any host without the native canvas binding) never
    // load the ESM-only package or its OpenCV WASM runtime
    const { PaddleOcrService: Service } = await import('ppu-paddle-ocr')
    const dir = this.modelDir()
    const files = {
      detection: join(dir, 'det.onnx'),
      recognition: join(dir, 'rec.onnx'),
      charactersDictionary: join(dir, 'dict.txt'),
    }
    for (const [kind, path] of Object.entries(files)) {
      try {
        await access(path)
      } catch {
        throw new Error(
          `OCR model not found at ${path} (${kind}) — run ` +
            `'pnpm --filter @photox/worker-service ocr-model'`,
        )
      }
    }

    const service = new Service({
      model: files,
      // ponytail: 2 ORT threads instead of the all-cores default — SigLIP/SCRFD/ArcFace sessions
      // are co-hosted in this process; raise only if OCR throughput starves the other queues
      session: { executionProviders: ['cpu'], intraOpNumThreads: 2 },
    })
    await service.initialize()
    this.logger.log(`OCR service loaded: ${dir}`)
    return service
  }

  async extract(image: Buffer): Promise<OcrExtract | null> {
    const service = await this.load()
    const arrayBuffer = image.buffer.slice(
      image.byteOffset,
      image.byteOffset + image.byteLength,
    ) as ArrayBuffer
    const result = await service.recognize(arrayBuffer, {
      minimumConfidence: OCR_MIN_CONFIDENCE,
    })
    return finalizeOcrText(result.text, result.confidence)
  }
}
