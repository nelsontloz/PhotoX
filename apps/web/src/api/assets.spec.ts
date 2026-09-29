import { describe, it, expect, vi } from 'vitest'
import type { Asset, AssetListResponse } from '@photox/shared-types'
import { getVideoStreamUrl, listAllAssets } from './assets'

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

describe('video URL builders', () => {
  it('getVideoStreamUrl targets core through the /api prefix and includes userId', () => {
    expect(getVideoStreamUrl('file-1', 'user-1')).toBe('/api/v1/files/file-1/stream?userId=user-1')
  })

  it('getVideoStreamUrl encodes special characters in userId', () => {
    const url = getVideoStreamUrl('file-1', 'user id with spaces')
    expect(url).toBe('/api/v1/files/file-1/stream?userId=user+id+with+spaces')
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

    const all = await listAllAssets({ limit: 50 })

    expect(getMock.mock.calls.map(([, config]) => config?.params?.offset)).toEqual([0, 50, 100])
    expect(all).toHaveLength(3)
  })
})
