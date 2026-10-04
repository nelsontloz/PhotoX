import { useEffect, useRef, useState } from 'react'
import type { AssetDetectionDto } from '@photox/shared-types'
import { boxToDisplayRect } from './detectionView'

// Below this the label chip would dwarf the box — outline only.
const MIN_LABEL_WIDTH = 34
const MIN_LABEL_HEIGHT = 18

interface DetectionOverlayProps {
  detections: AssetDetectionDto[]
  imageWidth: number
  imageHeight: number
}

export function DetectionOverlay({ detections, imageWidth, imageHeight }: DetectionOverlayProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  // Layout size of the aspect-locked image box. A transform never changes layout size, so one
  // measurement serves every zoom level — the parent's scale carries the boxes along for free.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ width: el.offsetWidth, height: el.offsetHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {size &&
        detections.map((detection, index) => {
          const rect = boxToDisplayRect(
            detection.box,
            imageWidth,
            imageHeight,
            size.width,
            size.height,
          )
          if (!rect) return null
          const showLabel = rect.width >= MIN_LABEL_WIDTH && rect.height >= MIN_LABEL_HEIGHT
          return (
            <div
              key={index}
              data-testid="detection-box"
              className="absolute border border-white/80 rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            >
              {showLabel && (
                <span className="absolute -top-px left-0 -translate-y-full whitespace-nowrap rounded-sm bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums">
                  {detection.label} {detection.confidence.toFixed(1)}
                </span>
              )}
            </div>
          )
        })}
    </div>
  )
}
