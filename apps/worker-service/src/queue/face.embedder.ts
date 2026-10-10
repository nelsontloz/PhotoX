import { Injectable, Logger } from '@nestjs/common'
import { join } from 'path'
import { loadEnv } from '@photox/shared-config'
import { FACE_EMBEDDING_DIM, l2Normalize } from '@photox/shared-types'
import { lazyOnce, requireModelFile } from './model-loader'
import type * as ort from 'onnxruntime-node'

// ponytail: InsightFace buffalo_l recognition weights (w600k_r50.onnx, ~174MB) are for
// non-commercial research use — provision with `pnpm --filter @photox/worker-service face-model`
// (official bundle, never committed) or point FACE_MODEL_PATH at your own copy.
export const FACE_MODEL_FILE = 'w600k_r50.onnx'
export const FACE_ALIGN_SIZE = 112

// ponytail: standard ArcFace 112x112 reference template (leftEye, rightEye, nose, mouthL, mouthR)
export const ARCFACE_TEMPLATE: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

export interface RawImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

interface SimilarityParams {
  a: number
  b: number
  tx: number
  ty: number
}

// ponytail: closed-form 2D similarity fit (dst = [[a,-b],[b,a]] src + t) — no SVD needed for this case
export function similarityFromPoints(
  src: [number, number][],
  dst: [number, number][],
): SimilarityParams {
  const n = src.length
  let mux = 0
  let muy = 0
  let mvx = 0
  let mvy = 0
  for (let i = 0; i < n; i++) {
    mux += src[i]![0]
    muy += src[i]![1]
    mvx += dst[i]![0]
    mvy += dst[i]![1]
  }
  mux /= n
  muy /= n
  mvx /= n
  mvy /= n
  let h11 = 0
  let h12 = 0
  let h21 = 0
  let h22 = 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const sx = src[i]![0] - mux
    const sy = src[i]![1] - muy
    const dx = dst[i]![0] - mvx
    const dy = dst[i]![1] - mvy
    h11 += dx * sx
    h12 += dx * sy
    h21 += dy * sx
    h22 += dy * sy
    s += sx * sx + sy * sy
  }
  // ponytail: degenerate (coincident points, tiny face) — fall back to translation so warp never NaNs
  if (s < 1e-12) return { a: 1, b: 0, tx: mvx - mux, ty: mvy - muy }
  const a = (h11 + h22) / s
  const b = (h21 - h12) / s
  return { a, b, tx: mvx - (a * mux - b * muy), ty: mvy - (b * mux + a * muy) }
}

// ponytail: pure-JS inverse-mapped bilinear warp — exact 112x112 output, no native warp quirks, unit-testable
export function alignFaceCrop(src: RawImage, points5: [number, number][]): Buffer {
  const { a, b, tx, ty } = similarityFromPoints(points5, ARCFACE_TEMPLATE)
  const k = a * a + b * b < 1e-12 ? 1 : a * a + b * b
  const A = a / k
  const B = b / k
  const C = -b / k
  const D = a / k
  const ox = -(A * tx + B * ty)
  const oy = -(C * tx + D * ty)
  const size = FACE_ALIGN_SIZE
  const out = Buffer.alloc(size * size * 3)
  const ch = src.channels >= 3 ? src.channels : 3
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const sx = A * u + B * v + ox
      const sy = C * u + D * v + oy
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(sx)))
      const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(sy)))
      const x1 = Math.min(src.width - 1, x0 + 1)
      const y1 = Math.min(src.height - 1, y0 + 1)
      const fx = Math.max(0, Math.min(1, sx - x0))
      const fy = Math.max(0, Math.min(1, sy - y0))
      const di = (v * size + u) * 3
      for (let c = 0; c < 3; c++) {
        const p00 = src.data[(y0 * src.width + x0) * ch + c]!
        const p10 = src.data[(y0 * src.width + x1) * ch + c]!
        const p01 = src.data[(y1 * src.width + x0) * ch + c]!
        const p11 = src.data[(y1 * src.width + x1) * ch + c]!
        out[di + c] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy,
        )
      }
    }
  }
  return out
}

// ponytail: ArcFace-family preprocessing — RGB 112x112, (x-127.5)/128, NCHW float32 (NOT faceres grayscale)
export function preprocessArcFace(rgb112: Buffer): Float32Array {
  const size = FACE_ALIGN_SIZE
  if (rgb112.length !== size * size * 3) {
    throw new Error(`Expected ${size}x${size} RGB buffer, got ${rgb112.length} bytes`)
  }
  const chw = new Float32Array(3 * size * size)
  for (let i = 0; i < size * size; i++) {
    chw[i] = (rgb112[i * 3]! - 127.5) / 128
    chw[size * size + i] = (rgb112[i * 3 + 1]! - 127.5) / 128
    chw[2 * size * size + i] = (rgb112[i * 3 + 2]! - 127.5) / 128
  }
  return chw
}

@Injectable()
export class FaceEmbedderService {
  private readonly logger = new Logger(FaceEmbedderService.name)
  private inputName = ''
  private outputName = ''
  private readonly load = lazyOnce(() => this.createSession())

  modelPath(): string {
    if (process.env.FACE_MODEL_PATH) return process.env.FACE_MODEL_PATH
    return join(loadEnv().STORAGE_DIR, 'models', FACE_MODEL_FILE)
  }

  private async createSession(): Promise<ort.InferenceSession> {
    // ponytail: lazy import so unit tests on Alpine (musl, no onnx native binding) never dlopen it —
    // same reason FaceDetectorService lazy-loads tfjs-node
    const { InferenceSession } = await import('onnxruntime-node')
    const modelPath = this.modelPath()
    await requireModelFile(
      modelPath,
      `Face embedding model not found at ${modelPath} — run ` +
        `'pnpm --filter @photox/worker-service face-model' or set FACE_MODEL_PATH`,
    )
    const session = await InferenceSession.create(modelPath, { executionProviders: ['cpu'] })
    this.inputName = session.inputNames[0]!
    this.outputName = session.outputNames[0]!
    this.logger.log(`Face embedder loaded: ${modelPath}`)
    return session
  }

  async embed(alignedRgb112: Buffer): Promise<number[]> {
    const session = await this.load()
    const { Tensor } = await import('onnxruntime-node')
    const input = preprocessArcFace(alignedRgb112)
    const tensor = new Tensor('float32', input, [1, 3, FACE_ALIGN_SIZE, FACE_ALIGN_SIZE])
    const output = await session.run({ [this.inputName]: tensor })
    const vec = Array.from(output[this.outputName]!.data as Float32Array)
    if (vec.length !== FACE_EMBEDDING_DIM) {
      throw new Error(`Unexpected face embedding dim ${vec.length}, expected ${FACE_EMBEDDING_DIM}`)
    }
    return l2Normalize(vec)
  }
}
