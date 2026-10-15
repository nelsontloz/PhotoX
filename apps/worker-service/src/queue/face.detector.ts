import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import sharp from 'sharp'
import { FaceEmbedderService, alignFaceCrop, type RawImage } from './face.embedder'
import { ScrfdFaceDetector } from './face.detector.scrfd'

export interface DetectedBox {
  box: { x: number; y: number; w: number; h: number }
  score: number
  // 5 points in input-buffer pixel coords, order: leftEye, rightEye, nose, mouthLeft, mouthRight
  points5: [number, number][]
}

export interface FaceDetectionBackend {
  load(): Promise<void>
  detect(buffer: Buffer): Promise<DetectedBox[]>
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
// app.module's body, after this module is evaluated.
@Injectable()
export class FaceDetectorService implements OnModuleInit {
  private readonly logger = new Logger(FaceDetectorService.name)
  private readonly backend: FaceDetectionBackend = new ScrfdFaceDetector()

  constructor(private readonly embedder: FaceEmbedderService) {}

  async onModuleInit() {
    try {
      await this.backend.load()
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

  async detect(buffer: Buffer): Promise<DetectedFace[]> {
    const boxes = await this.backend.detect(buffer)
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
