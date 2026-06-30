import {
  useRef,
  useCallback,
  useEffect,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'

export function useLongPress(callback: (e: ReactPointerEvent) => void, ms = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedRef = useRef(false)
  const justLongPressedRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    armedRef.current = false
  }, [])

  useEffect(() => clear, [clear])

  return {
    justLongPressedRef,
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') return
      justLongPressedRef.current = false
      armedRef.current = true
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        callback(e)
        justLongPressedRef.current = true
        armedRef.current = false
      }, ms)
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: ReactMouseEvent) => {
      if (armedRef.current) e.preventDefault()
    },
  }
}
