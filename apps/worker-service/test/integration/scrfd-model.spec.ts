import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { loadEnv } from '@photox/shared-config'
import { FACE_DETECTOR_MODEL_FILE, ScrfdFaceDetector } from '../../src/queue/face.detector.scrfd'

// not testcontainers: real ONNX session load + run + decode, skipped when the weights are absent
const modelPath =
  process.env.FACE_DETECTOR_MODEL_PATH ??
  join(loadEnv().STORAGE_DIR, 'models', FACE_DETECTOR_MODEL_FILE)

describe.skipIf(!existsSync(modelPath))('SCRFD face detector (integration)', () => {
  it('loads the session and decodes an image without throwing', async () => {
    const jpeg = await sharp({
      create: { width: 800, height: 600, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer()

    const detections = await new ScrfdFaceDetector().detect(jpeg)

    expect(Array.isArray(detections)).toBe(true)
  }, 120_000)
})
