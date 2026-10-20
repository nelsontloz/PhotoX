import type { PlaceFields } from '../places/places-resolve.service'

/** One asset row the keyset scan yields (lat/lng come back as raw SQL numerics). */
export interface PlacesBackfillItem {
  id: string
  latitude: string
  longitude: string
}

export interface PlacesBackfillDeps {
  /** One keyset page ordered by id ASC; `afterId` null starts at the beginning. */
  readPage: (afterId: string | null) => Promise<readonly PlacesBackfillItem[]>
  resolve: (latitude: number, longitude: number) => Promise<PlaceFields | null>
  apply: (assetId: string, place: PlaceFields) => Promise<unknown>
  warn: (message: string) => void
}

/**
 * Keyset-paged places backfill loop shared by the per-user (restore/merge
 * re-enqueue) and admin global sweeps: page -> resolve nearest city -> apply.
 * The caller owns the page query (userId filter vs admin paging) and the apply
 * write; failures stay per-asset (warn + continue) so one bad row never aborts
 * the sweep.
 */
export async function backfillPlaces(deps: PlacesBackfillDeps): Promise<void> {
  let afterId: string | null = null
  for (;;) {
    const items = await deps.readPage(afterId)
    if (items.length === 0) break
    for (const item of items) {
      try {
        const place = await deps.resolve(Number(item.latitude), Number(item.longitude))
        if (place) await deps.apply(item.id, place)
      } catch (err) {
        deps.warn(`place backfill failed for asset ${item.id}: ${String(err)}`)
      }
    }
    afterId = items[items.length - 1]!.id
  }
}
