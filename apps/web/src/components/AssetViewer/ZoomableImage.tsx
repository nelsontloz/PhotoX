import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { FIT_VIEW, MIN_SCALE, clampZoom, zoomTowards } from './zoomView'
import type { ZoomView } from './zoomView'

const DOUBLE_CLICK_SCALE = 2.5
const RESET_ANIMATION_MS = 220
// zoom factor per wheel event = exp(-deltaY * sensitivity)
const WHEEL_SENSITIVITY = 0.0025
const PINCH_SENSITIVITY = 0.01

interface Point {
  x: number
  y: number
}

interface Pinch {
  dist: number
  midX: number
  midY: number
}

interface Drag {
  id: number
  startX: number
  startY: number
  viewX: number
  viewY: number
}

interface ZoomableImageProps {
  src: string
  alt: string
  width: number
  height: number
  children?: ReactNode
}

export function ZoomableImage({ src, alt, width, height, children }: ZoomableImageProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ZoomView>(FIT_VIEW)
  const pointersRef = useRef(new Map<number, Point>())
  const dragRef = useRef<Drag | null>(null)
  const pinchRef = useRef<Pinch | null>(null)
  const [view, setView] = useState<ZoomView>(FIT_VIEW)
  const [dragging, setDragging] = useState(false)
  const [animate, setAnimate] = useState(false)

  const commit = useCallback((next: ZoomView) => {
    const prev = viewRef.current
    viewRef.current = next
    if (next.scale !== prev.scale || next.x !== prev.x || next.y !== prev.y) setView(next)
  }, [])

  const apply = useCallback(
    (update: (current: ZoomView) => ZoomView) => {
      commit(clampZoom(update(viewRef.current), imageRef.current, frameRef.current))
    },
    [commit],
  )

  const zoomAt = useCallback(
    (clientX: number, clientY: number, scale: number) => {
      commit(
        zoomTowards(viewRef.current, scale, clientX, clientY, imageRef.current, frameRef.current),
      )
    },
    [commit],
  )

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setAnimate(false)
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1)
      const sensitivity = event.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY
      zoomAt(event.clientX, event.clientY, viewRef.current.scale * Math.exp(-delta * sensitivity))
    }
    frame.addEventListener('wheel', handleWheel, { passive: false })
    return () => frame.removeEventListener('wheel', handleWheel)
  }, [zoomAt])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(() => {
      // re-clamp to the new frame (info panel toggle, window resize)
      apply((current) => current)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [apply])

  useEffect(() => {
    if (!animate) return
    const timer = setTimeout(() => setAnimate(false), RESET_ANIMATION_MS)
    return () => clearTimeout(timer)
  }, [animate])

  const reset = useCallback(() => {
    setAnimate(true)
    commit(FIT_VIEW)
  }, [commit])

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (viewRef.current.scale > MIN_SCALE) {
      reset()
    } else {
      setAnimate(true)
      zoomAt(event.clientX, event.clientY, DOUBLE_CLICK_SCALE)
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    setAnimate(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const current = viewRef.current
    if (pointersRef.current.size === 1) {
      dragRef.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        viewX: current.x,
        viewY: current.y,
      }
      setDragging(current.scale > MIN_SCALE)
    } else {
      dragRef.current = null
      pinchRef.current = readPinch(pointersRef.current)
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size >= 2) {
      const next = readPinch(pointersRef.current)
      const prev = pinchRef.current
      pinchRef.current = next
      if (!next || !prev || prev.dist <= 0) return
      zoomAt(prev.midX, prev.midY, viewRef.current.scale * (next.dist / prev.dist))
      apply((current) => ({
        ...current,
        x: current.x + next.midX - prev.midX,
        y: current.y + next.midY - prev.midY,
      }))
      return
    }
    const drag = dragRef.current
    if (drag?.id !== event.pointerId || viewRef.current.scale <= MIN_SCALE) return
    apply((current) => ({
      ...current,
      x: drag.viewX + event.clientX - drag.startX,
      y: drag.viewY + event.clientY - drag.startY,
    }))
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    pinchRef.current = null
    const remaining = [...pointersRef.current.entries()][0]
    if (remaining) {
      dragRef.current = {
        id: remaining[0],
        startX: remaining[1].x,
        startY: remaining[1].y,
        viewX: viewRef.current.x,
        viewY: viewRef.current.y,
      }
      setDragging(viewRef.current.scale > MIN_SCALE)
    } else {
      dragRef.current = null
      setDragging(false)
    }
  }

  const zoomed = view.scale > MIN_SCALE
  const cursorClass = zoomed ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'

  return (
    <div
      ref={frameRef}
      className="relative flex-1 self-stretch min-h-0 min-w-0 flex items-center justify-center touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
    >
      <div
        ref={imageRef}
        className={`relative max-h-full max-w-full origin-top-left ${cursorClass} ${
          animate ? 'transition-transform duration-200 ease-out' : ''
        }`}
        style={{
          aspectRatio: `${width} / ${height}`,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          decoding="async"
          className="block w-full h-full object-contain shadow-2xl select-none"
        />
        {children}
      </div>
      {zoomed && (
        <button
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          onDoubleClick={(event) => {
            event.stopPropagation()
          }}
          onClick={reset}
          className="absolute top-4 right-4 z-10 px-2.5 py-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white/80 hover:text-white text-xs font-medium tabular-nums backdrop-blur-sm transition-all cursor-pointer"
          title="Reset zoom"
        >
          {view.scale.toFixed(1)}×
        </button>
      )}
    </div>
  )
}

function readPinch(pointers: Map<number, Point>): Pinch | null {
  const [a, b] = [...pointers.values()]
  if (!a || !b) return null
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  }
}
