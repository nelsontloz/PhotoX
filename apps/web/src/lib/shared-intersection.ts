// One IntersectionObserver per scroll root instead of one per tile: a timeline day can mount
// hundreds of AssetThumbs, and each IO costs a main-thread registration + intersection pass.
// ponytail: cache keyed by root only — the sole consumer (AssetThumb) always passes the same shared
// margin; a second consumer with a different rootMargin must key the map by root+margin too.
let callbacks = new WeakMap<Element, (entry: IntersectionObserverEntry) => void>()
let roots = new WeakMap<Element, IntersectionObserver>()
let viewport: IntersectionObserver | null = null

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) callbacks.get(entry.target)?.(entry)
}

function getObserver(root: Element | null, rootMargin: string): IntersectionObserver {
  if (root === null) {
    return (viewport ??= new IntersectionObserver(onIntersect, { root: null, rootMargin }))
  }
  let io = roots.get(root)
  if (!io) {
    io = new IntersectionObserver(onIntersect, { root, rootMargin })
    roots.set(root, io)
  }
  return io
}

export function observeIntersecting(
  el: Element,
  root: Element | null,
  rootMargin: string,
  cb: (entry: IntersectionObserverEntry) => void,
): () => void {
  const io = getObserver(root, rootMargin)
  callbacks.set(el, cb)
  io.observe(el)
  return () => {
    callbacks.delete(el)
    io.unobserve(el)
  }
}

// Test hook: drop the cached observers/callbacks so the next call rebuilds against the current stub.
export function resetSharedIntersection(): void {
  callbacks = new WeakMap()
  roots = new WeakMap()
  viewport = null
}
