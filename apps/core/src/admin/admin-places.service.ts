import { Injectable, Logger } from '@nestjs/common'
import { AdminAssetsService } from './admin-assets.service'
import { PlacesResolveService } from '../places/places-resolve.service'
import { SettingsService } from '../settings/settings.service'
import type { LastRun } from '../settings/settings.service'

const BACKFILL_PAGE_SIZE = 500

@Injectable()
export class AdminPlacesService {
  private readonly logger = new Logger(AdminPlacesService.name)

  constructor(
    private readonly admin: AdminAssetsService,
    private readonly places: PlacesResolveService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Inline loop, no queue: one indexed KNN lookup per asset, all inside core's DB.
   * ponytail: assets whose nearest city is >50km away stay unresolved and are re-visited on the
   * next run — harmless at personal-library scale.
   */
  async backfill(): Promise<{ updated: number; total: number }> {
    const startedAt = new Date().toISOString()
    const total = await this.admin.countUnresolvedPlaces()
    let afterId: string | null = null
    let updated = 0
    for (;;) {
      const page = await this.admin.listUnresolvedPlaces(BACKFILL_PAGE_SIZE, afterId)
      if (page.items.length === 0) break
      for (const item of page.items) {
        try {
          const place = await this.places.resolve(Number(item.latitude), Number(item.longitude))
          if (place) {
            await this.admin.applyPlaceFields(item.id, place)
            updated++
          }
        } catch (err) {
          this.logger.warn(`place backfill failed for asset ${item.id}: ${String(err)}`)
        }
      }
      afterId = page.items[page.items.length - 1]!.id
    }
    await this.settings.setLastRun('places', { startedAt, total, updated })
    return { updated, total }
  }

  async status(): Promise<{ lastRun: LastRun<'places'> | null }> {
    return { lastRun: await this.settings.getLastRun('places') }
  }
}
