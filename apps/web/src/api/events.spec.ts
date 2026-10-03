import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Asset, AssetListResponse, EventGroupDto } from '@photox/shared-types'

interface ListAssetsParams {
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
const { listAssetsMock } = vi.hoisted(() => ({
  listAssetsMock: vi.fn<(params: ListAssetsParams) => Promise<AssetListResponse>>(),
}))

vi.mock('./client', () => ({ api: { get: getMock } }))
vi.mock('./assets', () => ({ listAssets: listAssetsMock }))

import { listEventGroups, listGroupAssets } from './events'

function makeAsset(id: string, kind: 'photo' | 'video' = 'photo'): Asset {
  return { id, kind, uploadedAt: '2025-06-01T10:00:00.000Z' } as Asset
}

const group: EventGroupDto = {
  id: 'g1',
  label: 'Paris · Jun 2025',
  takenFrom: '2025-06-01T10:00:00.000Z',
  takenTo: '2025-06-05T18:00:00.000Z',
  placeCity: 'Paris',
  placeCountryCode: 'FR',
  count: 250,
  coverAssetId: 'cover-1',
}

describe('listEventGroups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gets the events endpoint without query controls', async () => {
    getMock.mockResolvedValue({ data: { groups: [group] } })

    const res = await listEventGroups()

    expect(getMock).toHaveBeenCalledWith('/v1/events')
    expect(res.groups).toHaveLength(1)
  })
})

describe('listGroupAssets', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pages a group of 250 in chunks of 100 and stops at the count', async () => {
    listAssetsMock.mockImplementation((params) => {
      const offset = params.offset ?? 0
      const size = offset === 200 ? 50 : 100
      const items = Array.from({ length: size }, (_, i) => makeAsset(`p-${offset + i}`))
      return Promise.resolve({ items, total: 250, limit: 100, offset })
    })

    const items = await listGroupAssets(group)

    expect(listAssetsMock.mock.calls.map(([params]) => params.offset)).toEqual([0, 100, 200])
    expect(listAssetsMock.mock.calls[0]?.[0]).toMatchObject({
      dateFrom: group.takenFrom,
      dateTo: '2025-06-05T18:00:00.001Z', // exclusive server-side: the group's last instant + 1ms
      limit: 100,
    })
    expect(items).toHaveLength(250)
  })

  it('filters videos out of the window and stops on a short page', async () => {
    listAssetsMock.mockResolvedValueOnce({
      items: [makeAsset('p1'), makeAsset('v1', 'video'), makeAsset('p2')],
      total: 3,
      limit: 100,
      offset: 0,
    })

    const items = await listGroupAssets({ ...group, count: 3 })

    expect(listAssetsMock).toHaveBeenCalledTimes(1)
    expect(items.map((asset) => asset.id)).toEqual(['p1', 'p2'])
  })
})
