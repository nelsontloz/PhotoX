import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'
import type { FaceEmbedderService } from './face.embedder'

const mocks = vi.hoisted(() => ({
  humanLoad: vi.fn(),
  humanDetect: vi.fn(),
  scrfdLoad: vi.fn(),
  scrfdDetect: vi.fn(),
}))

vi.mock('./face.detector.human', () => ({
  landmarks5: vi.fn(),
  HumanFaceDetector: class {
    load = mocks.humanLoad
    detect = mocks.humanDetect
  },
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
  const prevDetector = process.env.FACE_DETECTOR

  beforeEach(async () => {
    delete process.env.FACE_DETECTOR
    vi.clearAllMocks()
    mocks.humanLoad.mockResolvedValue(undefined)
    mocks.scrfdLoad.mockResolvedValue(undefined)
    mocks.humanDetect.mockResolvedValue([])
    mocks.scrfdDetect.mockResolvedValue([])
    embed.mockResolvedValue(new Array<number>(512).fill(0))
    service = new FaceDetectorService({ embed } as unknown as FaceEmbedderService)
    image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
  })

  afterEach(() => {
    if (prevDetector === undefined) delete process.env.FACE_DETECTOR
    else process.env.FACE_DETECTOR = prevDetector
  })

  it('defaults to the human backend when FACE_DETECTOR is unset', async () => {
    await service.detect(image)

    expect(mocks.humanDetect).toHaveBeenCalledTimes(1)
    expect(mocks.scrfdDetect).not.toHaveBeenCalled()
  })

  it('defaults to the scrfd backend when FACE_DETECTOR=scrfd', async () => {
    process.env.FACE_DETECTOR = 'scrfd'

    await service.detect(image)

    expect(mocks.scrfdDetect).toHaveBeenCalledTimes(1)
    expect(mocks.humanDetect).not.toHaveBeenCalled()
  })

  it('skips embedding below FACE_MIN_SIZE_PX and embeds at the limit', async () => {
    mocks.humanDetect.mockResolvedValue([
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
    mocks.humanDetect.mockResolvedValue([
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
