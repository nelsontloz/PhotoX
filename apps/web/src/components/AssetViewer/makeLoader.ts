/**
 * Session cache + in-flight dedup for the viewer's lazy loaders (detections, related assets):
 * one entry per key, filled on first use. Failed fetches are not cached, so a later open retries
 * instead of pinning a transient error.
 */
export interface SessionLoader<V> {
  (key: string): Promise<V>
  /** Already-cached entry, or undefined — lets a hook skip the loading flash on a cache hit. */
  peek(key: string): V | undefined
}

export function makeLoader<V>(fetcher: (key: string) => Promise<V>): SessionLoader<V> {
  const cache = new Map<string, V>()
  const inflight = new Map<string, Promise<V>>()
  const load: SessionLoader<V> = (key) => {
    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached)
    const pending = inflight.get(key)
    if (pending) return pending
    const request = fetcher(key)
      .then((res) => {
        cache.set(key, res)
        return res
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, request)
    return request
  }
  load.peek = (key) => cache.get(key)
  return load
}
