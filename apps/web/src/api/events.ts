import type { Asset, EventGroupDto, EventsResponse } from '@photox/shared-types'
import { api } from './client'
import { listAssets } from './assets'

// The list endpoint caps `limit` at 100; group windows page through it.
const PAGE_SIZE = 100

export async function listEventGroups(): Promise<EventsResponse> {
  const { data } = await api.get<EventsResponse>('/v1/events')
  return data
}

/**
 * A group's assets, looked up through the existing date-window list endpoint. The events contract
 * carries no asset ids, so the group's own [takenFrom, takenTo] window is the lookup key; `dateTo`
 * is exclusive server-side, hence the +1ms. Events group photos only, so videos in the window are
 * filtered out. Pages of 100 are fetched until the group's count is covered or the window ends.
 * ponytail: tie-boundary misattribution — two photos sharing one timestamp split by a city change
 * leak the neighbor into the window and slice(0, count) drops one real photo (worst case: one photo).
 * Upgrade path: assetIds on EventGroupDto (splitEvents already holds the rows).
 */
export async function listGroupAssets(group: EventGroupDto): Promise<Asset[]> {
  const dateTo = new Date(new Date(group.takenTo).getTime() + 1).toISOString()
  const items: Asset[] = []
  let offset = 0
  while (items.length < group.count) {
    const page = await listAssets({
      dateFrom: group.takenFrom,
      dateTo,
      limit: PAGE_SIZE,
      offset,
    })
    items.push(...page.items.filter((asset) => asset.kind === 'photo'))
    if (page.items.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return items.slice(0, group.count)
}
