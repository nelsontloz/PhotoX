import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Asset } from '@photox/shared-types'

vi.mock('../api/search', () => ({ searchAssets: vi.fn() }))

import { searchAssets } from '../api/search'
import { useSearchStore, SEARCH_PAGE_SIZE } from './search-store'

const searchAssetsMock = vi.mocked(searchAssets)

function makeAsset(id: string): Asset {
  return { id, kind: 'photo' } as Asset
}

describe('search store', () => {
  beforeEach(() => {
    searchAssetsMock.mockReset()
    useSearchStore.setState({
      query: '',
      items: [],
      total: 0,
      loading: false,
      loadingMore: false,
      error: null,
    })
  })

  it('drops a stale response that lands after a newer query', async () => {
    let resolveFirst!: (value: { items: Asset[]; total: number }) => void
    searchAssetsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    const first = useSearchStore.getState().run('cat')
    searchAssetsMock.mockResolvedValueOnce({ items: [makeAsset('b')], total: 1 })
    const second = useSearchStore.getState().run('cats')
    resolveFirst({ items: [makeAsset('a')], total: 1 })
    await Promise.all([first, second])

    expect(useSearchStore.getState().query).toBe('cats')
    expect(useSearchStore.getState().items.map((a) => a.id)).toEqual(['b'])
  })

  it('appends the next page on loadMore and dedupes by id', async () => {
    searchAssetsMock.mockResolvedValueOnce({ items: [makeAsset('a')], total: 3 })
    await useSearchStore.getState().run('cat')
    searchAssetsMock.mockResolvedValueOnce({
      items: [makeAsset('a'), makeAsset('b')],
      total: 3,
    })
    await useSearchStore.getState().loadMore()

    expect(searchAssetsMock).toHaveBeenLastCalledWith({
      q: 'cat',
      limit: SEARCH_PAGE_SIZE,
      offset: 1,
    })
    expect(useSearchStore.getState().items.map((a) => a.id)).toEqual(['a', 'b'])
    expect(useSearchStore.getState().loadingMore).toBe(false)
  })

  it('maps a 503 to the friendly not-ready message', async () => {
    searchAssetsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503 },
    })
    await useSearchStore.getState().run('cat')

    expect(useSearchStore.getState().error).toContain('not ready')
    expect(useSearchStore.getState().loading).toBe(false)
  })
})
