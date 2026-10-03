import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AssetDetectionDto } from '@photox/shared-types'
import { DetectionOverlay } from './DetectionOverlay'
import { boxToDisplayRect, containRect, summarizeDetections } from './detectionView'

// jsdom reports 0x0 and has no ResizeObserver: pin a 400x400 media box, same trick as ZoomableImage.spec.
const CONTAINER = 400

function stubLayout(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(CONTAINER)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(CONTAINER)
}

function boxStyle(index = 0): CSSStyleDeclaration {
  const box = screen.getAllByTestId('detection-box')[index]
  if (!box) throw new Error(`detection box ${index} not rendered`)
  return box.style
}

beforeEach(stubLayout)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DetectionOverlay scaling', () => {
  it('scales original pixels and applies the letterbox offset of a contained image', () => {
    // 200x100 photo in a 400x400 box: scale 2, displayed 400x200 → 100px letterbox top/bottom
    const detections: AssetDetectionDto[] = [
      { label: 'dog', confidence: 0.9, box: { x: 50, y: 25, w: 50, h: 25 } },
    ]
    render(<DetectionOverlay detections={detections} imageWidth={200} imageHeight={100} />)

    expect(boxStyle()).toMatchObject({
      left: '100px',
      top: '150px',
      width: '100px',
      height: '50px',
    })
    expect(screen.getByText('dog 0.9')).toBeTruthy()
  })

  it('scales 1:1 when the image fills the box exactly', () => {
    const detections: AssetDetectionDto[] = [
      { label: 'cat', confidence: 0.42, box: { x: 10, y: 20, w: 100, h: 80 } },
    ]
    render(<DetectionOverlay detections={detections} imageWidth={400} imageHeight={400} />)

    expect(boxStyle()).toMatchObject({
      left: '10px',
      top: '20px',
      width: '100px',
      height: '80px',
    })
    expect(screen.getByText('cat 0.4')).toBeTruthy()
  })

  it('drops the label chip on boxes too small to carry it', () => {
    const detections: AssetDetectionDto[] = [
      { label: 'bird', confidence: 0.8, box: { x: 0, y: 0, w: 5, h: 5 } },
    ]
    render(<DetectionOverlay detections={detections} imageWidth={400} imageHeight={400} />)

    expect(screen.getAllByTestId('detection-box')).toHaveLength(1)
    expect(screen.queryByText('bird 0.8')).toBeNull()
  })

  it('renders nothing for an empty set', () => {
    render(<DetectionOverlay detections={[]} imageWidth={400} imageHeight={400} />)
    expect(screen.queryAllByTestId('detection-box')).toHaveLength(0)
  })
})

describe('detectionView math', () => {
  it('maps an original-pixel box through contain-fit scale and offsets', () => {
    // 100x100 photo in a 300x200 container: scale 2, displayed 200x200 → 50px pillarbox each side
    expect(boxToDisplayRect({ x: 10, y: 10, w: 20, h: 20 }, 100, 100, 300, 200)).toEqual({
      left: 70,
      top: 20,
      width: 40,
      height: 40,
    })
  })

  it('reports the contain rect with centered letterbox offsets', () => {
    expect(containRect(200, 100, 400, 400)).toEqual({ x: 0, y: 100, scale: 2 })
    expect(containRect(100, 100, 300, 200)).toEqual({ x: 50, y: 0, scale: 2 })
  })

  it('returns null for degenerate sizes', () => {
    expect(containRect(0, 100, 400, 400)).toBeNull()
    expect(boxToDisplayRect({ x: 0, y: 0, w: 1, h: 1 }, 100, 100, 0, 0)).toBeNull()
  })
})

describe('summarizeDetections', () => {
  const detection = (label: string, confidence = 0.5): AssetDetectionDto => ({
    label,
    confidence,
    box: { x: 0, y: 0, w: 10, h: 10 },
  })

  it('counts objects and labels in plain words', () => {
    expect(summarizeDetections([detection('dog'), detection('dog'), detection('cat')])).toBe(
      '3 objects: 2 dogs, 1 cat',
    )
    expect(summarizeDetections([detection('dog')])).toBe('1 object: 1 dog')
    expect(summarizeDetections([])).toBe('No objects detected')
  })

  it('collapses past three labels into a +N more tail', () => {
    expect(
      summarizeDetections([
        detection('dog'),
        detection('dog'),
        detection('cat'),
        detection('bird'),
        detection('car'),
      ]),
    ).toBe('5 objects: 2 dogs, 1 bird, 1 car, +1 more')
  })
})
