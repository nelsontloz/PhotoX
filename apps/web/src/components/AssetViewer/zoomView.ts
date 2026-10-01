export interface ZoomView {
  scale: number
  x: number
  y: number
}

/** The untransformed image box (HTMLElement satisfies this). */
export interface Measurable {
  offsetLeft: number
  offsetTop: number
  offsetWidth: number
  offsetHeight: number
}

/** The clamp frame — the media area the image is centered in. */
export interface RectSource {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}

export const MIN_SCALE = 1
export const MAX_SCALE = 8
export const FIT_VIEW: ZoomView = { scale: 1, x: 0, y: 0 }

/** Clamp a view so the image stays reachable: flush-left to flush-right when smaller than the frame, cover-clamped when larger. */
export function clampZoom(
  view: ZoomView,
  image: Measurable | null,
  frame: RectSource | null,
): ZoomView {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE)
  if (scale <= MIN_SCALE) return FIT_VIEW
  if (!image || !frame) return { ...view, scale }
  const { rect, left, top } = frameStart(image, frame)
  return {
    scale,
    x: clampOffset(view.x, left, image.offsetWidth * scale, rect.left, rect.width),
    y: clampOffset(view.y, top, image.offsetHeight * scale, rect.top, rect.height),
  }
}

/** Zoom to `scale` keeping the content point under (clientX, clientY) fixed, then clamp. */
export function zoomTowards(
  view: ZoomView,
  scale: number,
  clientX: number,
  clientY: number,
  image: Measurable | null,
  frame: RectSource | null,
): ZoomView {
  const next = clamp(scale, MIN_SCALE, MAX_SCALE)
  if (!image || !frame) return clampZoom({ ...view, scale: next }, image, frame)
  const { left, top } = frameStart(image, frame)
  const ratio = next / view.scale
  return clampZoom(
    {
      scale: next,
      x: clientX - left - (clientX - left - view.x) * ratio,
      y: clientY - top - (clientY - top - view.y) * ratio,
    },
    image,
    frame,
  )
}

function frameStart(image: Measurable, frame: RectSource): {
  rect: { left: number; top: number; width: number; height: number }
  left: number
  top: number
} {
  const rect = frame.getBoundingClientRect()
  return { rect, left: rect.left + image.offsetLeft, top: rect.top + image.offsetTop }
}

function clampOffset(
  offset: number,
  start: number,
  size: number,
  boxStart: number,
  boxSize: number,
): number {
  const flushStart = boxStart - start
  const flushEnd = boxStart + boxSize - start - size
  return clamp(offset, Math.min(flushStart, flushEnd), Math.max(flushStart, flushEnd))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
