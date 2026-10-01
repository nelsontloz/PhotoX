import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ZoomableImage } from './ZoomableImage'

// jsdom has no ResizeObserver and reports every box as 0x0, so pin the measurements the clamp reads:
// a 400x300 photo filling a 400x300 media area.
const IMAGE_W = 400
const IMAGE_H = 300

function stubLayout(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(IMAGE_W)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(IMAGE_H)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: IMAGE_W,
    height: IMAGE_H,
  } as DOMRect)
}

function renderZoomable(): { frame: HTMLElement; image: HTMLElement } {
  const { container } = render(
    <ZoomableImage src="/photo.jpg" alt="Photo" width={IMAGE_W} height={IMAGE_H} />,
  )
  const frame = container.firstElementChild as HTMLElement
  return { frame, image: frame.firstElementChild as HTMLElement }
}

function wheel(el: HTMLElement, init: WheelEventInit): boolean {
  return fireEvent(el, new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }))
}

beforeEach(stubLayout)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ZoomableImage', () => {
  it('zooms toward the cursor on wheel and cancels the event so nothing scrolls behind', () => {
    const { frame, image } = renderZoomable()

    expect(wheel(frame, { deltaY: -100, clientX: 100, clientY: 100 })).toBe(false)

    expect(image.style.transform).toContain('scale(1.284')
    expect(image.style.transform).toContain('translate(')
  })

  it('takes bigger steps for trackpad pinch (ctrl+wheel)', () => {
    const { frame, image } = renderZoomable()

    wheel(frame, { deltaY: -100, clientX: 100, clientY: 100, ctrlKey: true })

    expect(image.style.transform).toContain('scale(2.718')
  })

  it('double-click zooms at the pointer, double-click again resets to fit', () => {
    const { frame, image } = renderZoomable()

    fireEvent.doubleClick(frame, { clientX: 100, clientY: 100 })
    expect(image.style.transform).toBe('translate(-150px, -150px) scale(2.5)')

    fireEvent.doubleClick(frame, { clientX: 100, clientY: 100 })
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)')
  })

  it('shows a zoom indicator only while zoomed, and it resets on click', () => {
    const { frame, image } = renderZoomable()
    expect(screen.queryByTitle('Reset zoom')).toBeNull()

    wheel(frame, { deltaY: -100, clientX: 100, clientY: 100 })
    const reset = screen.getByTitle('Reset zoom')
    expect(reset.textContent).toBe('1.3×')

    fireEvent.click(reset)
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)')
    expect(screen.queryByTitle('Reset zoom')).toBeNull()
  })
})
