import { describe, expect, it } from 'vitest'
import { decodeScrfdOutputs, scrfdPreprocess } from './scrfd.decode'
import type { ScrfdCoordinateMap, ScrfdTensorLike } from './scrfd.decode'

// canonical layout: 2 anchors per cell (640/8)^2*2 = 12800, (640/16)^2*2 = 3200, (640/32)^2*2 = 800
function makeTensors(batched = true) {
  const make = (anchors: number, width: number) => ({
    dims: batched ? [1, anchors, width] : [anchors, width],
    data: new Array<number>(anchors * width).fill(0),
  })
  return {
    score: [make(12800, 1), make(3200, 1), make(800, 1)],
    bbox: [make(12800, 4), make(3200, 4), make(800, 4)],
    kps: [make(12800, 10), make(3200, 10), make(800, 10)],
  }
}

type Tensors = ReturnType<typeof makeTensors>
type Stride = 8 | 16 | 32

const STRIDE_INDEX: Record<Stride, number> = { 8: 0, 16: 1, 32: 2 }
const UNIT_MAP: ScrfdCoordinateMap = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }

function allTensors(t: Tensors): ScrfdTensorLike[] {
  return [...t.score, ...t.bbox, ...t.kps]
}

// both rows of a cell share one center: row i -> cell floor(i / 2), center = cell * stride
function setDetection(
  t: Tensors,
  stride: Stride,
  i: number,
  score: number,
  ltrb: [number, number, number, number] = [1, 2, 3, 4],
) {
  const s = STRIDE_INDEX[stride]
  t.score[s]!.data[i] = score
  const b = i * 4
  t.bbox[s]!.data[b] = ltrb[0]
  t.bbox[s]!.data[b + 1] = ltrb[1]
  t.bbox[s]!.data[b + 2] = ltrb[2]
  t.bbox[s]!.data[b + 3] = ltrb[3]
  for (let k = 0; k < 5; k++) {
    t.kps[s]!.data[i * 10 + k * 2] = k + 1
    t.kps[s]!.data[i * 10 + k * 2 + 1] = k + 1
  }
}

describe('scrfdPreprocess', () => {
  it('normalizes RGB pixels to CHW float32 with (x - 127.5) / 128', () => {
    const out = scrfdPreprocess({
      data: Uint8Array.from([0, 127, 255, 128, 0, 255]),
      width: 2,
      height: 1,
      channels: 3,
    })
    expect(out).toBeInstanceOf(Float32Array)
    expect(out.length).toBe(6)
    expect(out[0]).toBeCloseTo((0 - 127.5) / 128, 6)
    expect(out[1]).toBeCloseTo((128 - 127.5) / 128, 6)
    expect(out[2]).toBeCloseTo((127 - 127.5) / 128, 6)
    expect(out[3]).toBeCloseTo((0 - 127.5) / 128, 6)
    expect(out[4]).toBeCloseTo((255 - 127.5) / 128, 6)
    expect(out[5]).toBeCloseTo((255 - 127.5) / 128, 6)
  })

  it('throws for non-RGB buffers and non-positive dimensions', () => {
    const data = new Uint8Array(4)
    expect(() => scrfdPreprocess({ data, width: 1, height: 1, channels: 4 })).toThrow(/3-channel/)
    expect(() => scrfdPreprocess({ data, width: 0, height: 0, channels: 3 })).toThrow(
      /positive dimensions/,
    )
  })
})

describe('decodeScrfdOutputs', () => {
  it('decodes a stride-16 detection to source coordinates', () => {
    const t = makeTensors()
    // row 820 -> cell 410 -> grid (10,10) at stride 16 -> center (160,160)
    setDetection(t, 16, 820, 0.9)

    const dets = decodeScrfdOutputs(allTensors(t), {
      scaleX: 1.5,
      scaleY: 2,
      offsetX: 0,
      offsetY: 0,
    })

    expect(dets).toHaveLength(1)
    const det = dets[0]!
    expect(det.score).toBeCloseTo(0.9, 5)
    // deltas [1,2,3,4] * stride 16 -> [144,128]..[208,224], then scale x1.5 / y2
    expect(det.box.x).toBeCloseTo(216, 4)
    expect(det.box.y).toBeCloseTo(256, 4)
    expect(det.box.w).toBeCloseTo(96, 4)
    expect(det.box.h).toBeCloseTo(192, 4)
    expect(det.kps).toHaveLength(5)
    expect(det.kps[0]![0]).toBeCloseTo(264, 4)
    expect(det.kps[0]![1]).toBeCloseTo(352, 4)
    expect(det.kps[4]![0]).toBeCloseTo(360, 4)
    expect(det.kps[4]![1]).toBeCloseTo(480, 4)
  })

  it('applies a non-zero offset after scaling', () => {
    const t = makeTensors()
    setDetection(t, 16, 820, 0.9)

    const dets = decodeScrfdOutputs(allTensors(t), {
      scaleX: 1,
      scaleY: 1,
      offsetX: 5,
      offsetY: 7,
    })

    expect(dets).toHaveLength(1)
    expect(dets[0]!.box.x).toBeCloseTo(149, 4)
    expect(dets[0]!.box.y).toBeCloseTo(135, 4)
    expect(dets[0]!.box.w).toBeCloseTo(64, 4)
    expect(dets[0]!.box.h).toBeCloseTo(96, 4)
    expect(dets[0]!.kps[0]![0]).toBeCloseTo(181, 4)
    expect(dets[0]!.kps[0]![1]).toBeCloseTo(183, 4)
  })

  it('does not wrap x across a stride-8 grid row boundary', () => {
    const t = makeTensors()
    // cell 79 -> (79,0) center (632,0); cell 80 -> (0,1) center (0,8); rows 158 and 160
    setDetection(t, 8, 158, 0.9, [1, 1, 1, 1])
    setDetection(t, 8, 160, 0.8, [1, 1, 1, 1])

    const dets = decodeScrfdOutputs(allTensors(t), UNIT_MAP)

    expect(dets).toHaveLength(2)
    expect(dets[0]!.box.x).toBeCloseTo(624, 4)
    expect(dets[0]!.box.y).toBeCloseTo(-8, 4)
    expect(dets[1]!.box.x).toBeCloseTo(-8, 4)
    expect(dets[1]!.box.y).toBeCloseTo(0, 4)
  })

  it('does not wrap x across a stride-32 grid row boundary', () => {
    const t = makeTensors()
    // cell 19 -> (19,0) center (608,0); cell 20 -> (0,1) center (0,32); rows 38 and 40
    setDetection(t, 32, 38, 0.9, [1, 1, 1, 1])
    setDetection(t, 32, 40, 0.8, [1, 1, 1, 1])

    const dets = decodeScrfdOutputs(allTensors(t), UNIT_MAP)

    expect(dets).toHaveLength(2)
    expect(dets[0]!.box.x).toBeCloseTo(576, 4)
    expect(dets[0]!.box.y).toBeCloseTo(-32, 4)
    expect(dets[1]!.box.x).toBeCloseTo(-32, 4)
    expect(dets[1]!.box.y).toBeCloseTo(0, 4)
  })

  it('accepts the flat [anchors, C] layout exported by det_10g.onnx', () => {
    const t = makeTensors(false)
    setDetection(t, 16, 820, 0.9)

    const dets = decodeScrfdOutputs(allTensors(t), UNIT_MAP)

    expect(dets).toHaveLength(1)
    expect(dets[0]!.box.x).toBeCloseTo(144, 4)
    expect(dets[0]!.box.w).toBeCloseTo(64, 4)
  })

  it('keeps scores at the threshold and filters below it', () => {
    const atThreshold = makeTensors()
    setDetection(atThreshold, 16, 820, 0.5)
    expect(decodeScrfdOutputs(allTensors(atThreshold), UNIT_MAP)).toHaveLength(1)

    const below = makeTensors()
    setDetection(below, 16, 820, 0.49)
    expect(decodeScrfdOutputs(allTensors(below), UNIT_MAP)).toEqual([])

    const nan = makeTensors()
    setDetection(nan, 16, 820, Number.NaN)
    expect(decodeScrfdOutputs(allTensors(nan), UNIT_MAP)).toEqual([])
  })

  it('suppresses an overlapping duplicate with NMS', () => {
    const t = makeTensors()
    setDetection(t, 16, 820, 0.9)
    setDetection(t, 16, 821, 0.8) // same cell, identical box -> suppressed
    setDetection(t, 16, 0, 0.7, [1, 1, 1, 1]) // grid (0,0), no overlap -> kept

    const dets = decodeScrfdOutputs(allTensors(t), UNIT_MAP)

    expect(dets).toHaveLength(2)
    expect(dets.map((d) => d.score)).toEqual([0.9, 0.7])
  })

  it('throws on wrong tensor count, unknown anchor counts and bad dims', () => {
    const t = makeTensors()
    expect(() => decodeScrfdOutputs(allTensors(t).slice(0, 8), UNIT_MAP)).toThrow(/9 outputs/)

    const unknownAnchors = makeTensors()
    unknownAnchors.bbox[1]!.dims = [1, 1600, 4]
    expect(() => decodeScrfdOutputs(allTensors(unknownAnchors), UNIT_MAP)).toThrow(
      /anchor count 1600/,
    )

    const batchedDim = makeTensors()
    batchedDim.score[1]!.dims = [2, 3200, 1]
    expect(() => decodeScrfdOutputs(allTensors(batchedDim), UNIT_MAP)).toThrow(
      /Unexpected SCRFD tensor dims/,
    )
  })

  it('throws when a tensor length does not match its dims', () => {
    const t = makeTensors()
    t.score[1]!.data = new Array<number>(3199).fill(0)
    expect(() => decodeScrfdOutputs(allTensors(t), UNIT_MAP)).toThrow(
      /has 3199 values, expected 3200/,
    )
  })
})
