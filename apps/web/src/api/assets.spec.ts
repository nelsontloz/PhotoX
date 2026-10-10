import { describe, it, expect, vi } from 'vitest'
import type { Asset, AssetListResponse } from '@photox/shared-types'
import { getFileStreamUrl, getVideoStreamUrl, listAllAssets } from './assets'

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn<
    (
      url: string,
      config?: { params?: Record<string, unknown> },
    ) => Promise<{
      data: AssetListResponse
    }>
  >(),
}))

vi.mock('./client', () => ({ api: { get: getMock } }))

function makeAsset(id: string): Asset {
  return { id, kind: 'photo', uploadedAt: '2024-01-01T00:00:00Z' } as Asset
}

describe('stream URL builders', () => {
  it('getFileStreamUrl targets core through the /api prefix', () => {
    expect(getFileStreamUrl('file-1')).toBe('/api/v1/files/file-1/stream')
  })

  it('getVideoStreamUrl delegates to getFileStreamUrl', () => {
    expect(getVideoStreamUrl('file-1')).toBe(getFileStreamUrl('file-1'))
  })
})

describe('listAllAssets', () => {
  it('pages by limit until total is covered', async () => {
    getMock.mockImplementation((_url, config) => {
      const offset = Number(config?.params?.offset ?? 0)
      return Promise.resolve({
        data: {
          items: offset < 120 ? [makeAsset(`a-${offset}`)] : [],
          total: 120,
          limit: 50,
          offset,
        },
      })
    })

    const all = await listAllAssets({ limit: 50, personId: 'p-1' })

    expect(getMock.mock.calls.map(([, config]) => config?.params?.offset)).toEqual([0, 50, 100])
    // the person filter rides along on every page request
    expect(getMock.mock.calls.map(([, config]) => config?.params?.personId)).toEqual([
      'p-1',
      'p-1',
      'p-1',
    ])
    expect(all).toHaveLength(3)
  })

  it('requests the remaining pages in parallel', async () => {
    const resolvers = new Map<number, (value: { data: AssetListResponse }) => void>()
    getMock.mockImplementation((_url, config) => {
      const offset = Number(config?.params?.offset ?? 0)
      return new Promise((resolve) => resolvers.set(offset, resolve))
    })

    const pending = listAllAssets({ limit: 50 })
    expect(resolvers.has(0)).toBe(true)
    resolvers.get(0)!({ data: { items: [makeAsset('a-0')], total: 120, limit: 50, offset: 0 } })
    await vi.waitFor(() => expect(resolvers.has(100)).toBe(true))
    // both follow-up pages are in flight before either resolves
    expect(resolvers.has(50)).toBe(true)
    resolvers.get(50)!({ data: { items: [makeAsset('a-50')], total: 120, limit: 50, offset: 50 } })
    resolvers.get(100)!({
      data: { items: [makeAsset('a-100')], total: 120, limit: 50, offset: 100 },
    })
    const all = await pending
    // pages resolve out of order (50 before 100) but must concatenate in offset order
    expect(all.map((a) => a.id)).toEqual(['a-0', 'a-50', 'a-100'])
  })
})
