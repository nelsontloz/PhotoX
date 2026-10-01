import { describe, expect, it } from 'vitest'
import { FIT_VIEW, MAX_SCALE, clampZoom, zoomTowards } from './zoomView'
import type { Measurable, RectSource } from './zoomView'

function image(partial: Partial<Measurable> = {}): Measurable {
  return { offsetLeft: 150, offsetTop: 125, offsetWidth: 100, offsetHeight: 50, ...partial }
}

function frame(left = 0, top = 0, width = 400, height = 300): RectSource {
  return { getBoundingClientRect: () => ({ left, top, width, height }) }
}

describe('clampZoom', () => {
  it('snaps to fit at 1x and below', () => {
    expect(clampZoom({ scale: 0.5, x: 40, y: 40 }, image(), frame())).toEqual(FIT_VIEW)
    expect(clampZoom({ scale: 1, x: 40, y: 40 }, image(), frame())).toEqual(FIT_VIEW)
  })

  it('caps the scale at MAX_SCALE', () => {
    const fills = image({ offsetLeft: 0, offsetTop: 0, offsetWidth: 400, offsetHeight: 300 })
    expect(clampZoom({ scale: 99, x: 0, y: 0 }, fills, frame())).toEqual({
      scale: MAX_SCALE,
      x: 0,
      y: 0,
    })
  })

  it('cover-clamps once the image is bigger than the frame', () => {
    // 100x50 image, top at 25, in a 100x100 frame at 2x -> 200x100
    const img = image({ offsetLeft: 0, offsetTop: 25 })
    const box = frame(0, 0, 100, 100)
    expect(clampZoom({ scale: 2, x: -30, y: -25 }, img, box)).toEqual({ scale: 2, x: -30, y: -25 })
    expect(clampZoom({ scale: 2, x: 500, y: 500 }, img, box)).toEqual({ scale: 2, x: 0, y: -25 })
    expect(clampZoom({ scale: 2, x: -500, y: -500 }, img, box)).toEqual({
      scale: 2,
      x: -100,
      y: -25,
    })
  })

  it('keeps a smaller-than-frame image fully inside the frame', () => {
    const img = image({ offsetLeft: 50, offsetTop: 25 })
    const box = frame(0, 0, 400, 200)
    // at 2x: 200x100, so x may slide -50..150 and y -25..75
    expect(clampZoom({ scale: 2, x: 9999, y: 9999 }, img, box)).toEqual({
      scale: 2,
      x: 150,
      y: 75,
    })
    expect(clampZoom({ scale: 2, x: -9999, y: -9999 }, img, box)).toEqual({
      scale: 2,
      x: -50,
      y: -25,
    })
  })
})

describe('zoomTowards', () => {
  it('keeps the content point under the cursor fixed', () => {
    const img = image()
    const cursorX = 250
    const cursorY = 150
    const view = zoomTowards(FIT_VIEW, 2, cursorX, cursorY, img, frame())
    expect(view).toEqual({ scale: 2, x: -100, y: -25 })
    // the image pixel that was under the cursor is still under it
    const contentX = cursorX - img.offsetLeft
    const contentY = cursorY - img.offsetTop
    expect(img.offsetLeft + view.x + contentX * view.scale).toBeCloseTo(cursorX)
    expect(img.offsetTop + view.y + contentY * view.scale).toBeCloseTo(cursorY)
  })

  it('snaps back to fit when zooming out to 1x', () => {
    expect(zoomTowards({ scale: 4, x: -200, y: -100 }, 0.8, 200, 150, image(), frame())).toEqual(
      FIT_VIEW,
    )
  })
})
