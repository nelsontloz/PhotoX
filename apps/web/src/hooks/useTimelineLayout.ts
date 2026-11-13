import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AssetLayoutMonth } from '@photox/shared-types';
import { getAssetLayoutIndex, getAssetLayoutPage, type AssetFilters } from '../api/assets';
import { buildBuckets } from '../lib/timelineLayout';
import type { TimelineItem, TimelineLayout } from '../lib/timelineLayout';
import {
  diffMonths,
  pruneExcept,
  readMonths,
  writeMonth,
  type CachedMonth,
} from '../lib/layoutCache';
import { useAppStore } from '../store/app-store';
import { useAuthStore } from '../store/auth-store';

const EMPTY: TimelineItem[] = [];
/** Windows fetched at once — a cold load is one request per window plus its pages. */
const WINDOW_CONCURRENCY = 4;
/** Server default page size; the hard max is 5000, but there is no reason to exceed the default. */
const PAGE_LIMIT = 2000;

export interface UseTimelineLayoutResult {
  layout: TimelineLayout;
  /** Raw layout items in effective-date desc order — used for viewer navigation beyond the loaded months */
  layoutItems: TimelineItem[];
  containerRef: (el: HTMLDivElement | null) => void;
  /** Both measurement inputs are in: day heights are the real ones (before this, one row per day) */
  measured: boolean;
  loading: boolean;
  error: string | null;
}

/** `personId|favorite|albumId` — cache namespace key (UUIDs can't contain the separator). */
function filterKeyOf({ personId, favorite, albumId }: AssetFilters): string {
  return `${personId ?? ''}|${favorite ?? ''}|${albumId ?? ''}`;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * One whole window: offset-walk its pages. A page whose version differs from the first page's
 * means the month changed mid-walk — one restart, then the restart's version is the window's.
 */
async function fetchWindow(
  filters: AssetFilters,
  month: AssetLayoutMonth,
): Promise<{ items: TimelineItem[]; version: string }> {
  const walk = async (stopOnDrift: boolean) => {
    const items: TimelineItem[] = [];
    let version: string | null = null;
    let drifted = false;
    let offset = 0;
    for (;;) {
      const page = await getAssetLayoutPage({
        ...filters,
        from: month.from,
        to: month.to,
        offset,
        limit: PAGE_LIMIT,
      });
      if (version === null) version = page.version;
      else if (page.version !== version) {
        drifted = true;
        if (stopOnDrift) break;
      }
      items.push(...page.items);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    return { items, version: version ?? month.version, drifted };
  };
  const first = await walk(true);
  return first.drifted ? walk(false) : first;
}

/**
 * Builds the timeline layout from per-month windows (`/v1/timeline/index` + the offset-paged
 * window endpoint) instead of one whole-library response, so a change refetches only the windows
 * whose `version` moved. Month windows are persisted per user+filter in `layoutCache`; a warm load
 * is exactly one index request and zero page requests.
 *
 * `buildBuckets` stays the single source of bucket/day heights: every window must be present before
 * the track is replaced, so a refresh never shrinks the reserved space mid-flight (the grid's
 * restore and scroll anchoring depend on that). `layoutItems` remains the whole filtered set in
 * desc order — `useTimelineNav` navigates beyond the loaded months with it.
 *
 * person views skip the cache entirely: `faces` has no `updatedAt`, so clustering changes cannot be
 * fingerprinted and every mount refetches its windows.
 */
export function useTimelineLayout(filters: AssetFilters = {}): UseTimelineLayoutResult {
  const timelineRefreshKey = useAppStore((s) => s.timelineRefreshKey);

  const [layoutItems, setLayoutItems] = useState<TimelineItem[]>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters are read per load so the async body sees the latest values, while the effect is keyed
  // on the stable filter string (a page passes a literal object every render and must not re-index)
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const filterKey = filterKeyOf(filters);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const active = filtersRef.current;
      const cacheable = !active.personId;
      const userId = cacheable ? useAuthStore.getState().user?.id : undefined;
      try {
        const index = await getAssetLayoutIndex({ ...active, tz: localTimeZone() });
        if (cancelled) return;

        const monthKeys = index.months.map((month) => month.key);
        const cached: ReadonlyMap<string, CachedMonth> = cacheable
          ? await readMonths(userId, filterKey, monthKeys)
          : new Map();
        if (cancelled) return;

        const changed = diffMonths(index.months, cached);
        const fresh = new Map<string, TimelineItem[]>();
        // first failing window wins: the rest stop, but their in-flight request still settles
        let stopped = false;
        let cursor = 0;
        const worker = async () => {
          while (cursor < changed.length && !stopped) {
            const month = changed[cursor];
            cursor += 1;
            if (!month) return;
            try {
              const window = await fetchWindow(active, month);
              fresh.set(month.key, window.items);
              // persist only a window that still matches the index entry it was fetched for
              if (window.version === month.version && cacheable) {
                void writeMonth(userId, filterKey, month.key, {
                  from: month.from,
                  to: month.to,
                  count: month.count,
                  version: window.version,
                  items: window.items,
                });
              }
            } catch (err) {
              stopped = true;
              throw err instanceof Error ? err : new Error('timeline layout window failed');
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(WINDOW_CONCURRENCY, changed.length) }, worker),
        );
        if (cancelled) return;

        const items: TimelineItem[] = [];
        for (const month of index.months) {
          const fetched = fresh.get(month.key);
          if (fetched) {
            items.push(...fetched);
            continue;
          }
          const cachedWindow = cached.get(month.key);
          // every index window is either cached or fetched; a hole is a programming error
          if (!cachedWindow) throw new Error('timeline layout window missing');
          items.push(...cachedWindow.items);
        }

        setLayoutItems(items);
        setLoading(false);
        setError(null);
        if (cacheable) void pruneExcept(userId, filterKey, monthKeys);
      } catch (err) {
        if (cancelled) return;
        // failure keeps the previous items (none on a cold load) and hands the page its error state
        setError((err as Error).message ?? 'Failed to load timeline layout');
        setLoading(false);
      }
    };

    setError(null);
    void load();
    return () => {
      cancelled = true;
    };
  }, [timelineRefreshKey, filterKey]);

  const [containerWidth, setContainerWidth] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // ONE ResizeObserver on the grid container + a hidden probe carrying `.fixed-row-gallery`, so
  // rowHeight always comes from computed CSS. Never branch on `innerWidth < 640`: the media
  // query is `40rem`, which diverges from px when the user's root font-size isn't 16px.
  // The RO fires on every container resize (including window resizes), so no window listener.
  useLayoutEffect(() => {
    const probe = document.createElement('div');
    probe.className = 'justified-grid-gallery fixed-row-gallery';
    probe.style.cssText =
      'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
    document.body.appendChild(probe);
    const readRowHeight = () => {
      const px = parseFloat(getComputedStyle(probe).getPropertyValue('--row-height'));
      setRowHeight(Number.isFinite(px) ? px : 0);
    };
    readRowHeight();

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
      readRowHeight();
    });
    roRef.current = ro;
    if (containerElRef.current) ro.observe(containerElRef.current);

    return () => {
      ro.disconnect();
      roRef.current = null;
      probe.remove();
    };
  }, []);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerElRef.current = el;
    if (el) {
      // measured during commit so the first paint already has real widths (the RO below covers later changes)
      setContainerWidth(el.getBoundingClientRect().width);
      roRef.current?.observe(el);
    } else {
      roRef.current?.disconnect();
    }
  }, []);

  // resize only recomputes: the effect above never refetches, so the windows are reused as-is
  const layout = useMemo(
    () => buildBuckets(layoutItems, { containerWidth, rowHeight }),
    [layoutItems, containerWidth, rowHeight],
  );

  return {
    layout,
    layoutItems,
    containerRef,
    measured: containerWidth > 0 && rowHeight > 0,
    loading,
    error,
  };
}
