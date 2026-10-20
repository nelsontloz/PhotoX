import { describe, expect, it, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import type { FaceEmbedderService } from './face.embedder'
import { FACE_MIN_SIZE_PX, FaceDetectorService, type DetectedBox } from './face.detector'

// private surface exercised by the tests — the SCRFD session + letterbox pipeline lives in the
// service itself, so these stubs replace the ONNX round trip, not a backend object
interface DetectorInternals {
  session: () => Promise<unknown>
  detectBoxes: (buffer: Buffer) => Promise<DetectedBox[]>
}

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
  let internals: DetectorInternals
  let image: Buffer

  beforeEach(async () => {
    vi.clearAllMocks()
    embed.mockResolvedValue(new Array<number>(512).fill(0))
    service = new FaceDetectorService({ embed } as unknown as FaceEmbedderService)
    internals = service as unknown as DetectorInternals
    image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
  })

  it('always detects with the SCRFD pipeline', async () => {
    const detectBoxes = vi.spyOn(internals, 'detectBoxes').mockResolvedValue([])

    await service.detect(image)

    expect(detectBoxes).toHaveBeenCalledTimes(1)
    expect(detectBoxes).toHaveBeenCalledWith(image)
  })

  it('warms the SCRFD session on module init', async () => {
    const session = vi.spyOn(internals, 'session').mockResolvedValue({})

    await service.onModuleInit()

    expect(session).toHaveBeenCalledTimes(1)
  })

  it('warns instead of crashing on module init when the model is missing', async () => {
    vi.spyOn(internals, 'session').mockRejectedValue(
      new Error('Face detector model not found at /models/det_10g.onnx'),
    )

    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })

  it('skips embedding below FACE_MIN_SIZE_PX and embeds at the limit', async () => {
    vi.spyOn(internals, 'detectBoxes').mockResolvedValue([
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
    vi.spyOn(internals, 'detectBoxes').mockResolvedValue([
      { box: { x: 10, y: 10, w: 40, h: 40 }, score: 0.916666, points5: POINTS5 },
    ])

    const faces = await service.detect(image)

    expect(faces[0]!.confidence).toBe(0.9167)
  })

  it('returns empty without decoding or embedding when nothing is found', async () => {
    vi.spyOn(internals, 'detectBoxes').mockResolvedValue([])

    const faces = await service.detect(image)

    expect(faces).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })
})
