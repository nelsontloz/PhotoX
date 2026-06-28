import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import sharp from 'sharp'
import * as tf from '@tensorflow/tfjs-node'
import { Human, type FaceResult } from '@vladmandic/human'

@Injectable()
export class FaceDetectorService implements OnModuleInit {
  private readonly logger = new Logger(FaceDetectorService.name)
  private human!: Human

  async onModuleInit() {
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

  async detect(
    buffer: Buffer,
  ): Promise<
    {
      box: { x: number; y: number; w: number; h: number }
      confidence: number
      embedding: number[]
    }[]
  > {
    const jpeg = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
    const tensor = tf.node.decodeJpeg(jpeg)
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
