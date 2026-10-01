import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import sharp from 'sharp'
import { envFaceDetectorKind } from '@photox/shared-config'
import type { FaceDetectorKind } from '@photox/shared-types'
import { FaceEmbedderService, alignFaceCrop, type RawImage } from './face.embedder'
import type { FaceDetectionBackend } from './face.detector.types'
import { HumanFaceDetector } from './face.detector.human'
import { ScrfdFaceDetector } from './face.detector.scrfd'

export { landmarks5 } from './face.detector.human'

export interface DetectedFace {
  box: { x: number; y: number; w: number; h: number }
  confidence: number
  embedding: number[]
}

// Minimum face box side, in resized-input pixels: smaller crops are mush at the embedder's 112px
// and would waste an ONNX embed.
export const FACE_MIN_SIZE_PX = 40

// ponytail: FACE_DETECTOR stays a direct env read outside the zod schema (WORKER_SERVICE_PORT
// precedent); per-job `detector` overrides this default. Read lazily: .env is loaded in app.module's
// body, after this module is evaluated.
function defaultKind(): FaceDetectorKind {
  return envFaceDetectorKind()
}

@Injectable()
export class FaceDetectorService implements OnModuleInit {
  private readonly logger = new Logger(FaceDetectorService.name)
  private readonly backends = new Map<FaceDetectorKind, FaceDetectionBackend>()

  constructor(private readonly embedder: FaceEmbedderService) {}

  private backend(kind: FaceDetectorKind): FaceDetectionBackend {
    let backend = this.backends.get(kind)
    if (!backend) {
      backend = kind === 'scrfd' ? new ScrfdFaceDetector() : new HumanFaceDetector()
      this.backends.set(kind, backend)
    }
    return backend
  }

  private async loaded(kind: FaceDetectorKind): Promise<FaceDetectionBackend> {
    const backend = this.backend(kind)
    await backend.load()
    return backend
  }

  async onModuleInit() {
    const kind = defaultKind()
    try {
      await this.loaded(kind)
      this.logger.log(`Face detector ready: ${kind}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // ponytail: missing weights must not kill the worker at bootstrap — jobs fail per-asset
      // with the same provisioning error until the model is fetched
      this.logger.warn(
        `Face detector '${kind}' unavailable; detection will fail per-job until provisioned: ${message}`,
      )
    }
  }

  async detect(buffer: Buffer, kind: FaceDetectorKind = defaultKind()): Promise<DetectedFace[]> {
    const boxes = await (await this.loaded(kind)).detect(buffer)
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
}
