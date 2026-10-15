import { describe, expect, it, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import type { FaceEmbedderService } from './face.embedder'

const mocks = vi.hoisted(() => ({
  scrfdLoad: vi.fn(),
  scrfdDetect: vi.fn(),
}))

vi.mock('./face.detector.scrfd', () => ({
  ScrfdFaceDetector: class {
    load = mocks.scrfdLoad
    detect = mocks.scrfdDetect
  },
}))

import { FACE_MIN_SIZE_PX, FaceDetectorService } from './face.detector'

const POINTS5: [number, number][] = [
  [35, 35],
  [65, 35],
  [50, 50],
  [40, 70],
  [60, 70],
]

describe('FaceDetectorService', () => {
  const embed = vi.fn()
  let service: FaceDetectorService
  let image: Buffer

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.scrfdLoad.mockResolvedValue(undefined)
    mocks.scrfdDetect.mockResolvedValue([])
    embed.mockResolvedValue(new Array<number>(512).fill(0))
    service = new FaceDetectorService({ embed } as unknown as FaceEmbedderService)
    image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
  })

  it('always detects with the SCRFD backend', async () => {
    await service.detect(image)

    expect(mocks.scrfdDetect).toHaveBeenCalledTimes(1)
    expect(mocks.scrfdDetect).toHaveBeenCalledWith(image)
  })

  it('warms the SCRFD backend on module init', async () => {
    await service.onModuleInit()

    expect(mocks.scrfdLoad).toHaveBeenCalledTimes(1)
  })

  it('warns instead of crashing on module init when the model is missing', async () => {
    mocks.scrfdLoad.mockRejectedValue(
      new Error('Face detector model not found at /models/det_10g.onnx'),
    )

    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })

  it('skips embedding below FACE_MIN_SIZE_PX and embeds at the limit', async () => {
    mocks.scrfdDetect.mockResolvedValue([
      {
        box: { x: 10, y: 10, w: FACE_MIN_SIZE_PX - 1, h: FACE_MIN_SIZE_PX - 1 },
        score: 0.9,
        points5: POINTS5,
      },
      {
        box: { x: 10, y: 10, w: FACE_MIN_SIZE_PX, h: FACE_MIN_SIZE_PX },
        score: 0.9,
        points5: POINTS5,
      },
    ])

    const faces = await service.detect(image)

    expect(embed).toHaveBeenCalledTimes(1)
    expect(faces).toHaveLength(1)
    expect(faces[0]!.box.w).toBe(FACE_MIN_SIZE_PX)
  })

  it('rounds confidence to 4 decimals', async () => {
    mocks.scrfdDetect.mockResolvedValue([
      { box: { x: 10, y: 10, w: 40, h: 40 }, score: 0.916666, points5: POINTS5 },
    ])

    const faces = await service.detect(image)

    expect(faces[0]!.confidence).toBe(0.9167)
  })

  it('returns empty without decoding or embedding when the backend finds nothing', async () => {
    const faces = await service.detect(image)

    expect(faces).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })
})
