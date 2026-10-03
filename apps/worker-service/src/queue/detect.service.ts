import { Injectable, Logger } from '@nestjs/common'
import { access } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import { loadEnv } from '@photox/shared-config'
import type { DetectedObjectInput } from '@photox/shared-types'
import type * as ort from 'onnxruntime-node'

// ponytail: YOLO26n ONNX export (AGPL-3.0, Ultralytics yolo26n.pt via model.export(format="onnx"))
// provisioned by `pnpm --filter @photox/worker-service detect-model` into STORAGE_DIR/models/<dir>/ —
// offline-only at runtime, never committed.
export const DETECT_MODEL_DIR = 'yolo26n'
export const DETECT_MODEL_FILE = 'yolo26n.onnx'
export const DETECT_INPUT_SIZE = 640

// ponytail: 0.4 keeps weak person/blur blobs out of the labels union; the export's own end-to-end
// head already filtered at 0.25. Upgrade: tune once a corpus shows missed small objects.
export const DETECT_CONFIDENCE = 0.4

// core caps one asset's detection set at 200 rows (422 above) — same ceiling here
export const DETECT_MAX_DETECTIONS = 200

// COCO-80 in model output order (index = class id); a const beats a label-file dependency
export const COCO_LABELS = [
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'airplane',
  'bus',
  'train',
  'truck',
  'boat',
  'traffic light',
  'fire hydrant',
  'stop sign',
  'parking meter',
  'bench',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep',
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  'backpack',
  'umbrella',
  'handbag',
  'tie',
  'suitcase',
  'frisbee',
  'skis',
  'snowboard',
  'sports ball',
  'kite',
  'baseball bat',
  'baseball glove',
  'skateboard',
  'surfboard',
  'tennis racket',
  'bottle',
  'wine glass',
  'cup',
  'fork',
  'knife',
  'spoon',
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'chair',
  'couch',
  'potted plant',
  'bed',
  'dining table',
  'toilet',
  'tv',
  'laptop',
  'mouse',
  'remote',
  'keyboard',
  'cell phone',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'refrigerator',
  'book',
  'clock',
  'vase',
  'scissors',
  'teddy bear',
  'hair drier',
  'toothbrush',
] as const

export interface LetterboxParams {
  scale: number
  resizedW: number
  resizedH: number
  padLeft: number
  padTop: number
  padRight: number
  padBottom: number
}

// pure: Ultralytics letterbox geometry (min-side fit, centered 114-gray pad) — the same numbers
// feed sharp's resize+extend and the box scale-back below, so they can never drift apart
export function letterboxParams(
  width: number,
  height: number,
  size = DETECT_INPUT_SIZE,
): LetterboxParams {
  const scale = Math.min(size / width, size / height)
  const resizedW = Math.round(width * scale)
  const resizedH = Math.round(height * scale)
  const dw = (size - resizedW) / 2
  const dh = (size - resizedH) / 2
  // Math.max(0, ...) also normalizes -0 from Math.round(-0.1) to +0
  const padLeft = Math.max(0, Math.round(dw - 0.1))
  const padTop = Math.max(0, Math.round(dh - 0.1))
  return {
    scale,
    resizedW,
    resizedH,
    padLeft,
    padTop,
    padRight: size - resizedW - padLeft,
    padBottom: size - resizedH - padTop,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// pure: map YOLO26 end-to-end rows ([x1,y1,x2,y2,score,class] in letterboxed 640px space) back to
// original-image pixels, apply the confidence floor, drop unknown classes/degenerate boxes and
// clamp to the frame — the same discipline as face.processor's scale-back
export function parseDetections(
  output: ArrayLike<number>,
  rows: number,
  params: LetterboxParams,
  origW: number,
  origH: number,
): DetectedObjectInput[] {
  const detections: DetectedObjectInput[] = []
  for (let i = 0; i < rows; i++) {
    const base = i * 6
    const confidence = output[base + 4]!
    if (confidence < DETECT_CONFIDENCE) continue

    const label = COCO_LABELS[Math.round(output[base + 5]!)]
    if (!label) continue

    const x1 = clamp((output[base]! - params.padLeft) / params.scale, 0, origW)
    const y1 = clamp((output[base + 1]! - params.padTop) / params.scale, 0, origH)
    const x2 = clamp((output[base + 2]! - params.padLeft) / params.scale, 0, origW)
    const y2 = clamp((output[base + 3]! - params.padTop) / params.scale, 0, origH)
    if (x2 <= x1 || y2 <= y1) continue

    const box = {
      x: Math.round(x1 * 100) / 100,
      y: Math.round(y1 * 100) / 100,
      w: Math.round((x2 - x1) * 100) / 100,
      h: Math.round((y2 - y1) * 100) / 100,
    }
    // core rejects w/h <= 0 with 422 — drop sub-pixel boxes after rounding
    if (box.w <= 0 || box.h <= 0) continue

    detections.push({ label, confidence: Math.round(confidence * 10000) / 10000, box })
  }

  // core's replace-set cap is 200; keep the strongest when a frame overflows
  detections.sort((a, b) => b.confidence - a.confidence)
  return detections.slice(0, DETECT_MAX_DETECTIONS)
}

@Injectable()
export class DetectService {
  private readonly logger = new Logger(DetectService.name)
  private sessionPromise: Promise<ort.InferenceSession> | null = null
  private inputName = ''
  private outputName = ''

  modelPath(): string {
    return join(loadEnv().STORAGE_DIR, 'models', DETECT_MODEL_DIR, DETECT_MODEL_FILE)
  }

  private load(): Promise<ort.InferenceSession> {
    // ponytail: reset on rejection — jobs can run before detect-model is provisioned and must not
    // poison every later job until a worker restart (same pattern as EmbeddingService/OcrService)
    this.sessionPromise ??= this.createSession().catch((err: unknown) => {
      this.sessionPromise = null
      throw err
    })
    return this.sessionPromise
  }

  private async createSession(): Promise<ort.InferenceSession> {
    // ponytail: lazy import so unit tests (and hosts without the ORT native binding) never dlopen it
    const { InferenceSession } = await import('onnxruntime-node')
    const modelPath = this.modelPath()
    try {
      await access(modelPath)
    } catch {
      throw new Error(
        `Detection model not found at ${modelPath} — run ` +
          `'pnpm --filter @photox/worker-service detect-model'`,
      )
    }
    const session = await InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      // ponytail: 2 ORT threads instead of the all-cores default — SigLIP/PP-OCR/SCRFD sessions
      // are co-hosted in this process; raise only if detection throughput starves the other queues
      intraOpNumThreads: 2,
    })
    this.inputName = session.inputNames[0]!
    this.outputName = session.outputNames[0]!
    this.logger.log(`Detection model loaded: ${modelPath}`)
    return session
  }

  async detect(image: Buffer): Promise<DetectedObjectInput[]> {
    const session = await this.load()
    const { Tensor } = await import('onnxruntime-node')

    const meta = await sharp(image).metadata()
    if (!meta.width || !meta.height) throw new Error('Could not read image dimensions')
    const params = letterboxParams(meta.width, meta.height)

    // RGB letterboxed to 640x640 — sharp resize+extend uses the exact same geometry the box
    // scale-back consumes, so no coordinate drift
    const padded = await sharp(image)
      .resize(params.resizedW, params.resizedH, { fit: 'fill' })
      .extend({
        top: params.padTop,
        bottom: params.padBottom,
        left: params.padLeft,
        right: params.padRight,
        background: { r: 114, g: 114, b: 114 },
      })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer()

    const size = DETECT_INPUT_SIZE
    const chw = new Float32Array(3 * size * size)
    for (let i = 0; i < size * size; i++) {
      chw[i] = padded[i * 3]! / 255
      chw[size * size + i] = padded[i * 3 + 1]! / 255
      chw[2 * size * size + i] = padded[i * 3 + 2]! / 255
    }

    const tensor = new Tensor('float32', chw, [1, 3, size, size])
    const output = await session.run({ [this.inputName]: tensor })
    const result = output[this.outputName]!
    const dims = result.dims
    const rows = dims[1]
    if (dims.length !== 3 || rows === undefined || dims[2] !== 6) {
      throw new Error(`Unexpected detection output dims [${dims.join(', ')}], expected [1, n, 6]`)
    }

    return parseDetections(result.data as Float32Array, rows, params, meta.width, meta.height)
  }
}
