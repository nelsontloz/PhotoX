import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import sharp from 'sharp'
import type { FaceLandmark, FaceResult } from '@vladmandic/human'
import { FaceEmbedderService, alignFaceCrop, type RawImage } from './face.embedder'

export interface FaceLandmarks5 {
  leftEye: [number, number]
  rightEye: [number, number]
  nose: [number, number]
  mouthLeft: [number, number]
  mouthRight: [number, number]
}

export interface DetectedFace {
  box: { x: number; y: number; w: number; h: number }
  confidence: number
  embedding: number[]
}

// Minimum face box side, in resized-input pixels: smaller crops are mush at the embedder's 112px
// and would waste an ONNX embed.
export const FACE_MIN_SIZE_PX = 40

function meanXY(points: readonly (readonly number[])[] | undefined): [number, number] | null {
  if (!points || points.length === 0) return null
  let x = 0
  let y = 0
  let n = 0
  for (const p of points) {
    if (typeof p[0] !== 'number' || typeof p[1] !== 'number') continue
    x += p[0]
    y += p[1]
    n++
  }
  return n === 0 ? null : [x / n, y / n]
}

// ponytail: mesh landmarks when available, box-fraction estimates otherwise — alignment still
// normalizes scale/translation for the embedder even without rotation correction
export function landmarks5(
  face: Pick<FaceResult, 'annotations'>,
  box: { x: number; y: number; w: number; h: number },
): FaceLandmarks5 {
  const at = (fx: number, fy: number): [number, number] => [box.x + fx * box.w, box.y + fy * box.h]
  const a = face.annotations as Partial<Record<FaceLandmark, readonly (readonly number[])[]>>
  const lips = a.lipsUpperOuter?.length ? a.lipsUpperOuter : a.mouth
  let mouthLeft: [number, number] | null = null
  let mouthRight: [number, number] | null = null
  if (lips && lips.length > 0) {
    let min = lips[0]!
    let max = lips[0]!
    for (const p of lips) {
      if (p[0]! < min[0]!) min = p
      if (p[0]! > max[0]!) max = p
    }
    if (typeof min[0] === 'number' && typeof min[1] === 'number') mouthLeft = [min[0], min[1]]
    if (typeof max[0] === 'number' && typeof max[1] === 'number') mouthRight = [max[0], max[1]]
  }
  return {
    leftEye: meanXY(a.leftEye) ?? at(0.35, 0.38),
    rightEye: meanXY(a.rightEye) ?? at(0.65, 0.38),
    nose: meanXY(a.noseTip) ?? at(0.5, 0.55),
    mouthLeft: mouthLeft ?? at(0.38, 0.75),
    mouthRight: mouthRight ?? at(0.62, 0.75),
  }
}

@Injectable()
export class FaceDetectorService implements OnModuleInit {
  private readonly logger = new Logger(FaceDetectorService.name)
  // ponytail: lazy-loaded in onModuleInit so importing this file doesn't dlopen libtensorflow —
  // thumbnail/video processor tests override this provider and never touch face detection;
  // eager import crashes them on Alpine (musl, no ld-linux-x86-64.so.2)
  private tf!: typeof import('@tensorflow/tfjs-node')
  private human!: import('@vladmandic/human').Human

  constructor(private readonly embedder: FaceEmbedderService) {}

  async onModuleInit() {
    this.tf = await import('@tensorflow/tfjs-node')
    const { Human } = await import('@vladmandic/human')
    const humanEntry = require.resolve('@vladmandic/human')
    const modelsDir = join(dirname(humanEntry), '..', 'models')
    this.human = new Human({
      modelBasePath: pathToFileURL(modelsDir).toString() + '/',
      backend: 'tensorflow',
      face: {
        enabled: true,
        detector: { rotation: false, maxDetected: 20 },
        // ponytail: mesh on for 5-point alignment landmarks; description (faceres embedding) off —
        // recognition now comes from the InsightFace w600k_r50 ONNX model via FaceEmbedderService.
        // keepInvalid: false rejects detections whose mesh failed instead of aligning them with
        // guessed landmarks; landmarks5's box-fraction fallback stays for partial annotations.
        mesh: { enabled: true, keepInvalid: false },
        description: { enabled: false },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
    })

    await this.human.load()
    await this.human.warmup()
    this.logger.log('Human face detector warmed up')
  }

  async detect(buffer: Buffer): Promise<DetectedFace[]> {
    const jpeg = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
    const tensor = this.tf.node.decodeJpeg(jpeg)
    try {
      const result = await this.human.detect(tensor)
      if (result.face.length === 0) return []
      // ponytail: decode once, warp each face in-memory — avoids a sharp pipeline per face
      const raw = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
      const src: RawImage = {
        data: raw.data,
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      }
      const faces: DetectedFace[] = []
      for (const f of result.face) {
        const box = { x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3] }
        // check before alignment/embedding on purpose — skipping here saves the ONNX call
        if (Math.max(box.w, box.h) < FACE_MIN_SIZE_PX) continue
        const lm = landmarks5(f, box)
        const aligned = alignFaceCrop(src, [
          lm.leftEye,
          lm.rightEye,
          lm.nose,
          lm.mouthLeft,
          lm.mouthRight,
        ])
        const embedding = await this.embedder.embed(aligned)
        faces.push({ box, confidence: Number(f.score.toFixed(4)), embedding })
      }
      return faces
    } finally {
      tensor.dispose()
    }
  }
}
