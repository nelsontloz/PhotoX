import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import sharp from 'sharp'
import { resolveFaceDetectorModelPath } from '@photox/shared-config'
import { SCRFD_INPUT_SIZE, decodeScrfdOutputs, scrfdPreprocess } from './scrfd.decode'
import { lazyOnce, loadSession } from './model-loader'
import { FaceEmbedderService, alignFaceCrop, type RawImage } from './face.embedder'
import type * as ort from 'onnxruntime-node'

export interface DetectedBox {
  box: { x: number; y: number; w: number; h: number }
  score: number
  // 5 points in input-buffer pixel coords, order: leftEye, rightEye, nose, mouthLeft, mouthRight
  points5: [number, number][]
}

interface DetectedFace {
  box: { x: number; y: number; w: number; h: number }
  confidence: number
  embedding: number[]
}

// Minimum face box side, in resized-input pixels: smaller crops are mush at the embedder's 112px
// and would waste an ONNX embed.
export const FACE_MIN_SIZE_PX = 40

// ponytail: SCRFD-10G is the only detector. The model path stays a direct FACE_DETECTOR_MODEL_PATH
// env read (WORKER_SERVICE_PORT precedent) resolved lazily at load time: .env is loaded in
// app.module's body, after this module is evaluated. InsightFace det_10g detector weights (~17MB)
// are for non-commercial research use — provision with
// `pnpm --filter @photox/worker-service face-model` (never committed) or point
// FACE_DETECTOR_MODEL_PATH at your own copy.
@Injectable()
export class FaceDetectorService implements OnModuleInit {
  private readonly logger = new Logger(FaceDetectorService.name)
  private readonly session = lazyOnce(() => this.createSession())

  constructor(private readonly embedder: FaceEmbedderService) {}

  async onModuleInit() {
    try {
      await this.session()
      this.logger.log('Face detector ready: scrfd')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // ponytail: missing weights must not kill the worker at bootstrap — jobs fail per-asset
      // with the same provisioning error until the model is fetched
      this.logger.warn(
        `Face detector unavailable; detection will fail per-job until provisioned: ${message}`,
      )
    }
  }

  modelPath(): string {
    return resolveFaceDetectorModelPath()
  }

  private async createSession(): Promise<ort.InferenceSession> {
    const modelPath = this.modelPath()
    const session = await loadSession(
      modelPath,
      `Face detector model not found at ${modelPath} — run ` +
        `'pnpm --filter @photox/worker-service face-model' or set FACE_DETECTOR_MODEL_PATH`,
    )
    this.logger.log(`SCRFD face detector loaded: ${modelPath}`)
    return session
  }

  async detect(buffer: Buffer): Promise<DetectedFace[]> {
    const boxes = await this.detectBoxes(buffer)
    if (boxes.length === 0) return []
    // ponytail: decode once, warp each face in-memory — avoids a sharp pipeline per face
    const raw = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
    const src: RawImage = {
      data: raw.data,
      width: raw.info.width,
      height: raw.info.height,
      channels: raw.info.channels,
    }
    const faces: DetectedFace[] = []
    for (const { box, score, points5 } of boxes) {
      // check before alignment/embedding on purpose — skipping here saves the ONNX call
      if (Math.max(box.w, box.h) < FACE_MIN_SIZE_PX) continue
      const aligned = alignFaceCrop(src, points5)
      const embedding = await this.embedder.embed(aligned)
      faces.push({ box, confidence: Number(score.toFixed(4)), embedding })
    }
    return faces
  }

  private async detectBoxes(buffer: Buffer): Promise<DetectedBox[]> {
    const session = await this.session()

    // ponytail: upstream scrfd.py letterboxes (aspect-preserving resize + black pad, top-left),
    // not a squash; upscaling small images matches upstream too
    const meta = await sharp(buffer).metadata()
    if (!meta.width || !meta.height) throw new Error('Could not read image dimensions')
    const scale = Math.min(SCRFD_INPUT_SIZE / meta.width, SCRFD_INPUT_SIZE / meta.height)
    const newW = Math.round(meta.width * scale)
    const newH = Math.round(meta.height * scale)
    const scaled = await sharp(buffer)
      .removeAlpha()
      .toColourspace('srgb')
      .resize(newW, newH, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    // fit:'inside' can land 1px short of the requested box on odd aspect ratios, so copy the
    // actual pixels row by row into a black 640x640 letterbox (top-left pad) instead of extending
    // from the requested dims
    const channels = scaled.info.channels
    const letterboxed = Buffer.alloc(SCRFD_INPUT_SIZE * SCRFD_INPUT_SIZE * channels)
    const rowBytes = scaled.info.width * channels
    for (let y = 0; y < scaled.info.height; y++) {
      scaled.data.copy(
        letterboxed,
        y * SCRFD_INPUT_SIZE * channels,
        y * rowBytes,
        (y + 1) * rowBytes,
      )
    }

    const { Tensor } = await import('onnxruntime-node')
    const tensor = new Tensor(
      'float32',
      scrfdPreprocess({
        data: letterboxed,
        width: SCRFD_INPUT_SIZE,
        height: SCRFD_INPUT_SIZE,
        channels,
      }),
      [1, 3, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE],
    )

    const outputs = await session.run({ [session.inputNames[0]!]: tensor })
    const tensors = session.outputNames.map((name) => {
      const output = outputs[name]!
      return { dims: output.dims, data: output.data as Float32Array }
    })

    // pad is top-left, so source coords are a pure scale back from the actual resized dims
    return decodeScrfdOutputs(tensors, {
      scaleX: meta.width / scaled.info.width,
      scaleY: meta.height / scaled.info.height,
      offsetX: 0,
      offsetY: 0,
    }).map((det) => ({
      box: det.box,
      score: det.score,
      points5: det.kps,
    }))
  }
}
