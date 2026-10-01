import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BLOB_CACHE_MAX_BYTES,
  BLOB_CACHE_MAX_ENTRIES,
  clearBlobCache,
  getCachedBlobUrl,
  peekCachedBlobUrl,
} from './blob-cache'

let urlSeq = 0
const createObjectURL = vi.fn(() => `blob:mock-${++urlSeq}`)
const revokeObjectURL = vi.fn()

function blob(size = 1): Blob {
  return { size } as Blob
}

beforeEach(() => {
  urlSeq = 0
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  clearBlobCache()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

afterEach(() => {
  // jsdom has no blob-URL support, so the stubs above are own properties; drop them again.
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('getCachedBlobUrl', () => {
  it('shares one in-flight fetch across concurrent gets for the same key', async () => {
    const fetcher = vi.fn(() => Promise.resolve(blob()))

    const [first, second] = await Promise.all([
      getCachedBlobUrl('k', fetcher),
      getCachedBlobUrl('k', fetcher),
    ])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('serves a resolved entry without calling the fetcher again', async () => {
    const fetcher = vi.fn(() => Promise.resolve(blob()))

    const first = await getCachedBlobUrl('k', fetcher)
    const second = await getCachedBlobUrl('k', fetcher)

    expect(second).toBe(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('peek returns the url only once the entry has resolved', async () => {
    let resolveBlob: (value: Blob) => void = () => undefined
    const pending = new Promise<Blob>((resolve) => {
      resolveBlob = resolve
    })
    const promise = getCachedBlobUrl('k', () => pending)

    expect(peekCachedBlobUrl('k')).toBeUndefined()

    resolveBlob(blob())
    const url = await promise

    expect(peekCachedBlobUrl('k')).toBe(url)
  })

  it('drops a rejected entry so the next get retries', async () => {
    const fetcher = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(blob())

    await expect(getCachedBlobUrl('k', fetcher)).rejects.toThrow('boom')
    const url = await getCachedBlobUrl('k', fetcher)

    expect(peekCachedBlobUrl('k')).toBe(url)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest resolved entry when the entry cap is exceeded', async () => {
    const fetcher = vi.fn(() => Promise.resolve(blob()))
    for (let i = 0; i < BLOB_CACHE_MAX_ENTRIES; i++) {
      await getCachedBlobUrl(`k-${i}`, fetcher)
    }
    const oldestUrl = createObjectURL.mock.results[0]?.value as string

    await getCachedBlobUrl('k-extra', fetcher)
    expect(revokeObjectURL).toHaveBeenCalledWith(oldestUrl)

    // the evicted key is gone: getting it again refetches
    await getCachedBlobUrl('k-0', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(BLOB_CACHE_MAX_ENTRIES + 2)
  })

  it('evicts resolved entries back under the byte budget', async () => {
    const firstUrl = await getCachedBlobUrl('big-1', () =>
      Promise.resolve(blob(BLOB_CACHE_MAX_BYTES)),
    )
    const secondUrl = await getCachedBlobUrl('big-2', () =>
      Promise.resolve(blob(BLOB_CACHE_MAX_BYTES)),
    )

    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(secondUrl)
    expect(peekCachedBlobUrl('big-1')).toBeUndefined()
    expect(peekCachedBlobUrl('big-2')).toBe(secondUrl)
  })
})
