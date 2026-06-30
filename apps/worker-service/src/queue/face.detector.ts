import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import sharp from 'sharp'
import type { FaceResult } from '@vladmandic/human'

@Injectable()
export class FaceDetectorService implements OnModuleInit {
  private readonly logger = new Logger(FaceDetectorService.name)
  // ponytail: lazy-loaded in onModuleInit so importing this file doesn't dlopen libtensorflow —
  // thumbnail/video processor tests override this provider and never touch face detection;
  // eager import crashes them on Alpine (musl, no ld-linux-x86-64.so.2)
  private tf!: typeof import('@tensorflow/tfjs-node')
  private human!: import('@vladmandic/human').Human

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
        description: { enabled: true },
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

  async detect(buffer: Buffer): Promise<
    {
      box: { x: number; y: number; w: number; h: number }
      confidence: number
      embedding: number[]
    }[]
  > {
    const jpeg = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
    const tensor = this.tf.node.decodeJpeg(jpeg)
    try {
      const result = await this.human.detect(tensor)
      // ponytail: human may not return embedding for very small/blurry faces; skip rather than store zero-vector
      return result.face
        .filter((f: FaceResult) => f.embedding && f.embedding.length > 0)
        .map((f: FaceResult) => ({
          box: { x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3] },
          confidence: Number(f.score.toFixed(4)),
          embedding: f.embedding!,
        }))
    } finally {
      tensor.dispose()
    }
  }
}
