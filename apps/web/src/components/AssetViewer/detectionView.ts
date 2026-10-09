import type { AssetDetectionDto, DetectionBox } from '@photox/shared-types'

interface DisplayRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Rendered rect of an image drawn with `object-fit: contain` in a container: fit scale plus the
 * centered letterbox offsets. Null when any input is non-positive.
 *
 * The viewer's ZoomableImage box is aspect-locked to the asset's dimensions, so its offsets are
 * zero — but the overlay is written against the general contain rule so it stays correct if it is
 * ever mounted on a container whose aspect differs from the image.
 */
export function containRect(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number; scale: number } | null {
  if (imageWidth <= 0 || imageHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return null
  }
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
  return {
    x: (containerWidth - imageWidth * scale) / 2,
    y: (containerHeight - imageHeight * scale) / 2,
    scale,
  }
}

/** Original-image-pixel box → displayed-pixel rect inside a contain-fitted container. */
export function boxToDisplayRect(
  box: DetectionBox,
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
): DisplayRect | null {
  const fit = containRect(imageWidth, imageHeight, containerWidth, containerHeight)
  if (!fit) return null
  return {
    left: fit.x + box.x * fit.scale,
    top: fit.y + box.y * fit.scale,
    width: box.w * fit.scale,
    height: box.h * fit.scale,
  }
}

function plural(label: string, count: number): string {
  return count === 1 || label.endsWith('s') ? label : `${label}s`
}

/** Quiet one-liner: "3 objects: 2 dogs, 1 cat" (top three labels, then "+N more"). */
export function summarizeDetections(detections: AssetDetectionDto[]): string {
  if (detections.length === 0) return 'No objects detected'
  const counts = new Map<string, number>()
  for (const detection of detections) {
    counts.set(detection.label, (counts.get(detection.label) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const parts = sorted.slice(0, 3).map(([label, count]) => `${count} ${plural(label, count)}`)
  const extra = sorted.length - parts.length
  const noun = detections.length === 1 ? 'object' : 'objects'
  return `${detections.length} ${noun}: ${parts.join(', ')}${extra > 0 ? `, +${extra} more` : ''}`
}
