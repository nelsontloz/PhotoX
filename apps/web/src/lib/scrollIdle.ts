// ponytail: shared scroll-idle gate so visible tiles all arm at the same time — the old per-tile
// entry timers fired staggered in scroll order. Capture-phase window listener catches every scroll
// container. 300ms matches the old per-tile delay; per-element timers if this ever shows in profiles.
const SETTLE_MS = 300

let settleTimer: ReturnType<typeof setTimeout> | undefined
let idle = true
const waiters = new Set<() => void>()

window.addEventListener(
  'scroll',
  () => {
    idle = false
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      idle = true
      for (const w of waiters) w()
      waiters.clear()
    }, SETTLE_MS)
  },
  { capture: true, passive: true },
)

/** Run `cb` now if scrolling is settled, else once it settles. Returns a cancel function. */
export function whenScrollIdle(cb: () => void): () => void {
  if (idle) cb()
  else waiters.add(cb)
  return () => waiters.delete(cb)
}
