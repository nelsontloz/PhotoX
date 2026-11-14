import { useMemo } from 'react';
import type { Asset } from '@photox/shared-types';
import type { AssetFilters } from '../api/assets';
import { useTimelineLayout, type UseTimelineLayoutResult } from './useTimelineLayout';
import { useTimelineMonths, type UseTimelineMonthsResult } from './useTimelineMonths';
import { useTimelineNav } from './useTimelineNav';

export interface UseTimelineViewResult {
  /** Layout skeleton: buckets/heights, raw layout items, containerRef, loading/error */
  timeline: UseTimelineLayoutResult;
  /** Per-month lazy cache: day groups, month statuses, ensureMonth, retainMonths */
  months: UseTimelineMonthsResult;
  /** Every loaded asset (flattened groups) — viewer navigation + sibling list */
  loadedAssets: Asset[];
  /** Beyond-the-loaded-set helpers for useAssetNavigation (timeline pages resolve `?asset=` ids) */
  navHelpers: ReturnType<typeof useTimelineNav> & { resolveMissing: boolean };
}

/**
 * The timeline pipeline shared by every timeline-backed view (home, favorites, person, album,
 * add-photos dialog): layout skeleton + per-month cache + loaded assets + nav helpers in one call.
 */
export function useTimelineView(filters: AssetFilters = {}): UseTimelineViewResult {
  const timeline = useTimelineLayout(filters);
  const months = useTimelineMonths(filters);
  const loadedAssets = useMemo(() => months.groups.flatMap((g) => g.items), [months.groups]);
  const navHelpers = {
    ...useTimelineNav({
      layoutItems: timeline.layoutItems,
      ensureMonth: months.ensureMonth,
    }),
    // Deep link (?asset=<id>) to an asset whose month isn't fetched: useAssetNavigation fetches
    // the asset itself so the viewer opens instead of waiting for a month that may never enter
    // the mount window.
    resolveMissing: true,
  };
  return { timeline, months, loadedAssets, navHelpers };
}
