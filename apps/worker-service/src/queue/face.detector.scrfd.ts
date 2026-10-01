import { Logger } from '@nestjs/common'
import { access } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import { loadEnv } from '@photox/shared-config'
import { SCRFD_INPUT_SIZE, decodeScrfdOutputs, scrfdPreprocess } from './scrfd.decode'
import type { DetectedBox, FaceDetectionBackend } from './face.detector.types'
import type * as ort from 'onnxruntime-node'

// ponytail: InsightFace SCRFD det_10g detector weights (~17MB) are for non-commercial research
// use — provision with `pnpm --filter @photox/worker-service face-model` (never committed) or
// point FACE_DETECTOR_MODEL_PATH at your own copy.
export const FACE_DETECTOR_MODEL_FILE = 'det_10g.onnx'

export class ScrfdFaceDetector implements FaceDetectionBackend {
  private readonly logger = new Logger(ScrfdFaceDetector.name)
  private sessionPromise?: Promise<ort.InferenceSession>

  modelPath(): string {
    if (process.env.FACE_DETECTOR_MODEL_PATH) return process.env.FACE_DETECTOR_MODEL_PATH
    return join(loadEnv().STORAGE_DIR, 'models', FACE_DETECTOR_MODEL_FILE)
  }

  private session(): Promise<ort.InferenceSession> {
    // clear a rejected promise so a later attempt (e.g. after provisioning) retries
    this.sessionPromise ??= this.createSession().catch((err) => {
      this.sessionPromise = undefined
      throw err
    })
    return this.sessionPromise
  }

  private async createSession(): Promise<ort.InferenceSession> {
    // ponytail: lazy import so unit tests on Alpine (musl, no onnx native binding) never dlopen it
    const { InferenceSession } = await import('onnxruntime-node')
    const modelPath = this.modelPath()
    try {
      await access(modelPath)
    } catch {
      throw new Error(
        `Face detector model not found at ${modelPath} — run ` +
          `'pnpm --filter @photox/worker-service face-model' or set FACE_DETECTOR_MODEL_PATH`,
      )
    }
    const session = await InferenceSession.create(modelPath, { executionProviders: ['cpu'] })
    this.logger.log(`SCRFD face detector loaded: ${modelPath}`)
    return session
  }

  async load(): Promise<void> {
    await this.session()
  }

  async detect(buffer: Buffer): Promise<DetectedBox[]> {
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
    // fit:'inside' can land 1px short of the requested box on odd aspect ratios, so pad from the
    // actual dims rather than the requested ones
    const resized = await sharp(scaled.data, {
      raw: {
        width: scaled.info.width,
        height: scaled.info.height,
        channels: scaled.info.channels,
      },
    })
      .extend({
        right: SCRFD_INPUT_SIZE - scaled.info.width,
        bottom: SCRFD_INPUT_SIZE - scaled.info.height,
        background: { r: 0, g: 0, b: 0 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (resized.info.width !== SCRFD_INPUT_SIZE || resized.info.height !== SCRFD_INPUT_SIZE) {
      throw new Error(
        `SCRFD letterbox produced ${resized.info.width}x${resized.info.height}, ` +
          `expected ${SCRFD_INPUT_SIZE}x${SCRFD_INPUT_SIZE}`,
      )
    }

    const { Tensor } = await import('onnxruntime-node')
    const tensor = new Tensor(
      'float32',
      scrfdPreprocess({
        data: resized.data,
        width: resized.info.width,
        height: resized.info.height,
        channels: resized.info.channels,
      }),
      [1, 3, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE],
    )

    const outputs = await session.run({ [session.inputNames[0]!]: tensor })
    const tensors = session.outputNames.map((name) => {
      const output = outputs[name]!
      return { dims: output.dims, data: output.data as Float32Array }
    })

    // pad is top-left, so source coords are a pure scale back from letterbox space; use the
    // actual resized dims (see above) as the effective scale
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
