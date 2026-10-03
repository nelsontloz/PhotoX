import { describe, expect, it } from 'vitest'
import {
  COCO_LABELS,
  DETECT_CONFIDENCE,
  DETECT_MAX_DETECTIONS,
  letterboxParams,
  parseDetections,
  scaleDetectionsToOriginal,
} from './detect.service'

function output(rows: number[][]): Float32Array {
  return new Float32Array(rows.flat())
}

describe('letterboxParams', () => {
  it('fits landscape into 640 with centered vertical padding', () => {
    expect(letterboxParams(1280, 720)).toEqual({
      scale: 0.5,
      resizedW: 640,
      resizedH: 360,
      padLeft: 0,
      padTop: 140,
      padRight: 0,
      padBottom: 140,
    })
  })

  it('fits portrait with horizontal padding', () => {
    expect(letterboxParams(720, 1280)).toEqual({
      scale: 0.5,
      resizedW: 360,
      resizedH: 640,
      padLeft: 140,
      padTop: 0,
      padRight: 140,
      padBottom: 0,
    })
  })

  it('upscales small images — letterbox always targets 640', () => {
    expect(letterboxParams(320, 240)).toEqual({
      scale: 2,
      resizedW: 640,
      resizedH: 480,
      padLeft: 0,
      padTop: 80,
      padRight: 0,
      padBottom: 80,
    })
  })
})

describe('parseDetections', () => {
  // 1280x720 -> scale 0.5, 140px letterbox pad on top/bottom
  const params = letterboxParams(1280, 720)

  it('maps a letterboxed box back to original pixels and names the class', () => {
    const dets = parseDetections(output([[100, 240, 300, 440, 0.9, 0]]), 1, params, 1280, 720)
    expect(dets).toEqual([
      { label: 'person', confidence: 0.9, box: { x: 200, y: 200, w: 400, h: 400 } },
    ])
  })

  it('drops below-floor and unknown-class rows', () => {
    const rows = [
      [100, 240, 300, 440, DETECT_CONFIDENCE - 0.01, 0],
      [100, 240, 300, 440, 0.9, 999],
    ]
    expect(parseDetections(output(rows), 2, params, 1280, 720)).toEqual([])
  })

  it('clamps boxes to the frame and drops degenerate ones', () => {
    const rows = [
      [-100, 100, 2000, 2000, 0.8, 2], // clamps to the full frame
      [300, 300, 300, 400, 0.8, 2], // zero width after clamping -> dropped
    ]
    const dets = parseDetections(output(rows), 2, params, 1280, 720)
    expect(dets).toHaveLength(1)
    expect(dets[0]!.box).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
    expect(dets[0]!.label).toBe('car')
  })

  it('caps at the core row limit, strongest first', () => {
    const rows = Array.from({ length: DETECT_MAX_DETECTIONS + 5 }, (_, i) => [
      100,
      240,
      300,
      440,
      0.5 + i / 1000,
      0,
    ])
    const dets = parseDetections(output(rows), rows.length, params, 1280, 720)
    expect(dets).toHaveLength(DETECT_MAX_DETECTIONS)
    expect(dets[0]!.confidence).toBeGreaterThan(dets.at(-1)!.confidence)
  })

  it('maps the last COCO index', () => {
    const dets = parseDetections(output([[0, 140, 100, 240, 0.7, 79]]), 1, params, 1280, 720)
    expect(dets[0]!.label).toBe(COCO_LABELS[79])
  })
})

describe('scaleDetectionsToOriginal', () => {
  it('maps prep-space boxes to original pixels with a known resize factor', () => {
    const dets = [
      { label: 'person', confidence: 0.9, box: { x: 100, y: 50, w: 200, h: 150 } },
      { label: 'car', confidence: 0.8, box: { x: 1200, y: 700, w: 200, h: 100 } },
    ]
    // 1280x720 prep -> 3840x2160 original (3x)
    expect(scaleDetectionsToOriginal(dets, 3, 3, 3840, 2160)).toEqual([
      { label: 'person', confidence: 0.9, box: { x: 300, y: 150, w: 600, h: 450 } },
      // right/bottom edges poke past the frame -> clamped
      { label: 'car', confidence: 0.8, box: { x: 3600, y: 2100, w: 240, h: 60 } },
    ])
  })
})
