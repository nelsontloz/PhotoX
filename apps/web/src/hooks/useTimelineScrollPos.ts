import { useContext, useLayoutEffect, useState, type RefObject } from 'react'
import { ScrollContainerContext } from '../components/AppShell'

/**
 * rAF-throttled { scrollTop, clientHeight } of the timeline's scroll container.
 *
 * Defaults to ScrollContainerContext (AppShell's <main>). `containerOverride` is for callers the
 * context can't reach: the dialog component itself sits ABOVE the Provider it renders, so only a
 * ref override points its rail at the dialog's own scroller.
 *
 * No container → keeps { top: 0, height: 0 }, which TimelineGrid reads as "no viewport → mount
 * everything" (its safe fallback).
 */
export function useTimelineScrollPos(containerOverride?: RefObject<HTMLDivElement>): {
  top: number
  height: number
} {
  const contextContainer = useContext(ScrollContainerContext)
  const container = containerOverride ?? contextContainer
  const [scrollPos, setScrollPos] = useState({ top: 0, height: 0 })

  useLayoutEffect(() => {
    const el = container?.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      setScrollPos({ top: el.scrollTop, height: el.clientHeight })
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [container])

  return scrollPos
}
