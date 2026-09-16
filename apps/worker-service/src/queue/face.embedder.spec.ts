import { describe, it, expect } from 'vitest'
import {
  ARCFACE_TEMPLATE,
  FACE_ALIGN_SIZE,
  alignFaceCrop,
  l2Normalize,
  preprocessArcFace,
  similarityFromPoints,
  type RawImage,
} from './face.embedder'
import { landmarks5 } from './face.detector'

const solid = (w: number, h: number, r: number, g: number, b: number): RawImage => {
  const data = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = r
    data[i * 3 + 1] = g
    data[i * 3 + 2] = b
  }
  return { data, width: w, height: h, channels: 3 }
}

describe('similarityFromPoints', () => {
  it('recovers identity for identical point sets', () => {
    const { a, b, tx, ty } = similarityFromPoints(ARCFACE_TEMPLATE, ARCFACE_TEMPLATE)
    expect(a).toBeCloseTo(1, 6)
    expect(b).toBeCloseTo(0, 6)
    expect(tx).toBeCloseTo(0, 6)
    expect(ty).toBeCloseTo(0, 6)
  })

  it('recovers scale and translation', () => {
    const src: [number, number][] = [
      [0, 0],
      [10, 0],
      [0, 10],
      [10, 10],
      [5, 5],
    ]
    const dst: [number, number][] = src.map(([x, y]) => [2 * x + 10, 2 * y - 5])
    const { a, b, tx, ty } = similarityFromPoints(src, dst)
    expect(a).toBeCloseTo(2, 6)
    expect(b).toBeCloseTo(0, 6)
    expect(tx).toBeCloseTo(10, 6)
    expect(ty).toBeCloseTo(-5, 6)
  })

  it('recovers a 90-degree rotation', () => {
    const src: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ]
    const dst: [number, number][] = [
      [3, 3],
      [3, 4],
      [2, 3],
    ]
    const { a, b, tx, ty } = similarityFromPoints(src, dst)
    expect(a).toBeCloseTo(0, 6)
    expect(b).toBeCloseTo(1, 6)
    expect(tx).toBeCloseTo(3, 6)
    expect(ty).toBeCloseTo(3, 6)
  })
})

describe('alignFaceCrop', () => {
  const pts: [number, number][] = [
    [1, 1],
    [6, 1],
    [3, 3],
    [2, 5],
    [5, 5],
  ]

  it('outputs 112x112 RGB', () => {
    const out = alignFaceCrop(solid(8, 6, 10, 20, 30), pts)
    expect(out.length).toBe(FACE_ALIGN_SIZE * FACE_ALIGN_SIZE * 3)
  })

  it('preserves constant color (all samples land in-bounds)', () => {
    const out = alignFaceCrop(solid(8, 6, 10, 20, 30), pts)
    for (let i = 0; i < out.length; i += 3) {
      expect(out[i]).toBe(10)
      expect(out[i + 1]).toBe(20)
      expect(out[i + 2]).toBe(30)
    }
  })

  it('clamps out-of-bounds samples instead of throwing', () => {
    const far: [number, number][] = [
      [-500, -500],
      [500, -500],
      [0, 0],
      [-500, 500],
      [500, 500],
    ]
    const out = alignFaceCrop(solid(8, 6, 10, 20, 30), far)
    expect(out.length).toBe(FACE_ALIGN_SIZE * FACE_ALIGN_SIZE * 3)
  })
})

describe('preprocessArcFace', () => {
  it('maps pixels to (x-127.5)/128 in channel-first order', () => {
    const rgb = Buffer.alloc(FACE_ALIGN_SIZE * FACE_ALIGN_SIZE * 3)
    for (let i = 0; i < FACE_ALIGN_SIZE * FACE_ALIGN_SIZE; i++) {
      rgb[i * 3] = 255
      rgb[i * 3 + 1] = 0
      rgb[i * 3 + 2] = 0
    }
    const chw = preprocessArcFace(rgb)
    const plane = FACE_ALIGN_SIZE * FACE_ALIGN_SIZE
    expect(chw.length).toBe(3 * plane)
    expect(chw[0]).toBeCloseTo((255 - 127.5) / 128, 6)
    expect(chw[plane]).toBeCloseTo((0 - 127.5) / 128, 6)
    expect(chw[2 * plane]).toBeCloseTo((0 - 127.5) / 128, 6)
  })

  it('rejects wrong-size buffers', () => {
    expect(() => preprocessArcFace(Buffer.alloc(10))).toThrow()
  })
})

describe('l2Normalize', () => {
  it('produces unit norm', () => {
    const out = l2Normalize([3, 4])
    expect(out[0]).toBeCloseTo(0.6, 6)
    expect(out[1]).toBeCloseTo(0.8, 6)
  })

  it('passes zero vectors through without NaN', () => {
    expect(l2Normalize([0, 0])).toEqual([0, 0])
  })
})

describe('landmarks5', () => {
  const box = { x: 10, y: 20, w: 100, h: 100 }

  it('falls back to box fractions without annotations', () => {
    const lm = landmarks5({ annotations: {} } as never, box)
    expect(lm.leftEye).toEqual([45, 58])
    expect(lm.rightEye).toEqual([75, 58])
    expect(lm.nose).toEqual([60, 75])
  })

  it('uses mesh annotation means when present', () => {
    const lm = landmarks5(
      {
        annotations: {
          leftEye: [
            [30, 50, 0],
            [34, 50, 0],
          ],
          rightEye: [
            [70, 50, 0],
            [74, 50, 0],
          ],
          noseTip: [[52, 70, 0]],
          lipsUpperOuter: [
            [40, 90, 0],
            [64, 90, 0],
          ],
        },
      } as never,
      box,
    )
    expect(lm.leftEye).toEqual([32, 50])
    expect(lm.rightEye).toEqual([72, 50])
    expect(lm.nose).toEqual([52, 70])
    expect(lm.mouthLeft).toEqual([40, 90])
    expect(lm.mouthRight).toEqual([64, 90])
  })
})
