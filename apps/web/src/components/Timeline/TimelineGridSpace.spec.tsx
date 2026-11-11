import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor, act } from '@testing-library/react';
import type { RefObject } from 'react';
import type { AssetLayoutIndex, AssetLayoutPage, User } from '@photox/shared-types';
import { buildBuckets, dayContentY, type TimelineItem } from '../../lib/timelineLayout';
import { monthKeyOf } from '../../lib/dateFormat';
import { resetDayMemory } from '../../lib/timelineDayMemory';
import { ScrollContainerContext } from '../AppShell';
import { useAppStore } from '../../store/app-store';
import { useAuthStore } from '../../store/auth-store';

// Pinned measurement inputs — jsdom has no ResizeObserver and resolves no stylesheet vars, so the
// stubs below must feed useTimelineLayout exactly these values.
const CONTAINER_WIDTH = 1000;
const ROW_HEIGHT = 200;
const LAYOUT_OPTIONS = { containerWidth: CONTAINER_WIDTH, rowHeight: ROW_HEIGHT };

// Realistic layout payload: two months, mixed aspects, one null-dims item (→ 1:1), and
// a day that wraps past one row. Local-noon times keep groupDateSortKey stable in every timezone.
const LAYOUT_ITEMS: TimelineItem[] = [
  // 2026-03-20 — four 4:3 tiles (266.7px) → three fit, the fourth wraps → 2 rows
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  // 2026-03-15 — 16:9 + null dims (200px) + 16:9 → 1 row
  { t: '2026-03-15T12:00:00', w: 1920, h: 1080 },
  { t: '2026-03-15T12:00:00', w: null, h: null },
  { t: '2026-03-15T12:00:00', w: 1920, h: 1080 },
  // 2026-02-10 — two 1:1 → 1 row
  { t: '2026-02-10T12:00:00', w: 1000, h: 1000 },
  { t: '2026-02-10T12:00:00', w: 1000, h: 1000 },
  // 2026-02-01 — five 16:9 (355.6px) → two per row, the fifth wraps → 3 rows
  ...Array.from({ length: 5 }, () => ({ t: '2026-02-01T12:00:00', w: 1920, h: 1080 })),
  // Filler months (two days each) so the document is several screens taller than the mount window.
  // Without this the window covers the whole timeline and windowing can't be told apart from
  // "mount everything" — the window grew to ±(1 viewport + TIMELINE_PREFETCH_PX).
  ...(['2026-01', '2025-12', '2025-11', '2025-10', '2025-09'] as const).flatMap((month) => [
    ...Array.from({ length: 5 }, () => ({ t: `${month}-15T12:00:00`, w: 1920, h: 1080 })),
    ...Array.from({ length: 3 }, () => ({ t: `${month}-10T12:00:00`, w: 1000, h: 1000 })),
  ]),
];

vi.mock('../../api/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/assets')>();
  return { ...actual, getAssetLayoutIndex: vi.fn(), getAssetLayoutPage: vi.fn() };
});

import { getAssetLayoutIndex, getAssetLayoutPage } from '../../api/assets';
import { useTimelineLayout } from '../../hooks/useTimelineLayout';
import { TimelineGrid } from './TimelineGrid';

const getIndexMock = vi.mocked(getAssetLayoutIndex);
const getPageMock = vi.mocked(getAssetLayoutPage);

// Live month windows: the index and page mocks both read them, so a test can mutate one month
// and let the hook re-index it. `from` is the mock's window id (`<key>-start`).
let windows: Map<string, { items: TimelineItem[]; version: string }>;
let userSeq = 0;

function resetWindows(): void {
  const grouped = new Map<string, TimelineItem[]>();
  for (const item of LAYOUT_ITEMS) {
    const key = monthKeyOf(item.t);
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  }
  windows = new Map(
    [...grouped].map(([key, items]) => [
      key,
      {
        items: [...items].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()),
        version: `v${items.length}`,
      },
    ]),
  );
}

function layoutIndex(): AssetLayoutIndex {
  return {
    // key desc, like the API
    months: [...windows.keys()]
      .sort()
      .reverse()
      .map((key) => {
        const win = windows.get(key);
        return {
          key,
          from: `${key}-start`,
          to: `${key}-end`,
          count: win?.items.length ?? 0,
          version: win?.version ?? '0',
        };
      }),
  };
}

function stubLayoutApi(): void {
  getIndexMock.mockReset();
  getPageMock.mockReset();
  getIndexMock.mockImplementation(() => Promise.resolve(layoutIndex()));
  getPageMock.mockImplementation((params) => {
    const key = params.from.replace(/-start$/, '');
    const items = windows.get(key)?.items ?? [];
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 2000;
    const slice = items.slice(offset, offset + limit);
    const next = offset + slice.length;
    return Promise.resolve({
      from: params.from,
      to: params.to,
      version: windows.get(key)?.version ?? '0',
      total: items.length,
      // the wire payload never carries null dims: they pack as 1:1
      items: slice.map((item) => ({ t: item.t, w: item.w ?? 1, h: item.h ?? 1 })),
      nextOffset: next < items.length ? next : null,
    } satisfies AssetLayoutPage);
  });
}

function stubMeasurement(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: CONTAINER_WIDTH,
    height: 800,
  } as DOMRect);

  const realGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    // the hook's hidden .fixed-row-gallery probe is the only reader of --row-height
    if (el.classList.contains('fixed-row-gallery') && el.parentElement === document.body) {
      return {
        getPropertyValue: (name: string) => (name === '--row-height' ? `${ROW_HEIGHT}px` : ''),
      } as CSSStyleDeclaration;
    }
    return realGetComputedStyle(el);
  });
}

function stubTimelineData(): void {
  resetWindows();
  stubLayoutApi();
  useAppStore.setState({ timelineRefreshKey: 0 });
  // one fresh cache namespace per test: the layout cache is module-level in-memory in jsdom
  useAuthStore.setState({ user: { id: `grid-space-${++userSeq}` } as User });
  stubMeasurement();
}

const noopEnsureMonth = (): Promise<null> => Promise.resolve(null);
const noopRetainMonths = vi.fn();
const onSelectStub = vi.fn();
const onToggleSelectStub = vi.fn();

// Cheapest seam that keeps the real data flow: layout index + windows → useTimelineLayout → grid.
function TimelineHarness({ rememberScroll }: { rememberScroll?: boolean }) {
  const { layout, containerRef, measured } = useTimelineLayout();
  return (
    <TimelineGrid
      layout={layout}
      containerRef={containerRef}
      measured={measured}
      rememberScroll={rememberScroll}
      groups={[]}
      monthStatus={new Map()}
      ensureMonth={noopEnsureMonth}
      retainMonths={noopRetainMonths}
      onSelect={onSelectStub}
      selectedIds={new Set()}
      onToggleSelect={onToggleSelectStub}
    />
  );
}

/** Waits for the complete layout: the track reserves `totalHeight` only after every window landed. */
async function waitForTrack(container: HTMLElement, totalHeight: number): Promise<void> {
  await waitFor(() => {
    const track = container.querySelector<HTMLElement>('.max-w-6xl');
    expect(track?.style.height).toBe(`${totalHeight}px`);
  });
}

/** Scroll container fake: scrollTop is writable, scrollTo moves it synchronously like a browser. */
function fakeScroller() {
  const el = document.createElement('div');
  let top = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  Object.defineProperty(el, 'clientHeight', { value: 700 });
  const scrollTo = vi.fn(({ top: next }: ScrollToOptions) => {
    top = next ?? 0;
  });
  el.scrollTo = scrollTo as unknown as HTMLDivElement['scrollTo'];
  return { ref: { current: el }, scrollTo };
}

function renderWithScroller(ref: RefObject<HTMLDivElement>, rememberScroll: boolean) {
  return render(
    <ScrollContainerContext.Provider value={ref}>
      <TimelineHarness rememberScroll={rememberScroll} />
    </ScrollContainerContext.Provider>,
  );
}

describe('TimelineGrid reserved space', () => {
  beforeEach(stubTimelineData);

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reserves exactly the buildBuckets() space fed by the layout index + windows', async () => {
    const expected = buildBuckets(LAYOUT_ITEMS, LAYOUT_OPTIONS);
    // guard the fixture so the comparison can't pass vacuously
    expect(expected.buckets.map((b) => b.key)).toEqual([
      '2026-03',
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
      '2025-09',
    ]);
    expect(expected.buckets[0]?.days[0]?.sortKey).toBe('2026-03-20');
    expect(expected.buckets[0]?.days[0]?.height).toBe(469); // 65 + 2×204 − 4

    const { container } = render(<TimelineHarness />);

    // container track: reserved height must equal totalHeight
    const track = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.max-w-6xl');
      expect(el).not.toBeNull();
      expect(el?.style.height).toBe(`${expected.totalHeight}px`);
      return el!;
    });
    expect(getIndexMock).toHaveBeenCalledTimes(1);
    expect(getPageMock).toHaveBeenCalledTimes(expected.buckets.length); // one window each

    // month buckets: absolute top + height per bucket, then each day section's height
    const monthEls = Array.from(track.children) as HTMLElement[];
    expect(monthEls).toHaveLength(expected.buckets.length);

    expected.buckets.forEach((bucket, i) => {
      const monthEl = monthEls[i];
      expect(monthEl?.style.top).toBe(`${bucket.top}px`);
      expect(monthEl?.style.height).toBe(`${bucket.height}px`);

      const dayEls = Array.from(monthEl?.children ?? []) as HTMLElement[];
      expect(dayEls).toHaveLength(bucket.days.length);
      bucket.days.forEach((day, j) => {
        expect(dayEls[j]?.style.height).toBe(`${day.height}px`);
      });
    });
  });

  it('mounts only the days intersecting the scroll window, keeping reserved heights', async () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: 0 });
    Object.defineProperty(el, 'clientHeight', { value: 100 });
    const scrollRef: RefObject<HTMLDivElement> = { current: el };

    const { container } = render(
      <ScrollContainerContext.Provider value={scrollRef}>
        <TimelineHarness />
      </ScrollContainerContext.Provider>,
    );

    // window = [0 − 100 − 2000, 0 + 2×100 + 2000] = [−2100, 2200]: buckets 2026-03 (top 0),
    // 2026-02 (814) and 2026-01 (1832) are mounted; 2025-12 (2850) is not. The straddling bucket is
    // the interesting one — 2026-01-15 (dayTop 1832) is in-window and renders, 2026-01-10 (dayTop
    // 2545) is not and renders nothing. Container height still spans the unmounted tail, so nothing
    // below collapses.
    const track = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.max-w-6xl');
      expect(el).not.toBeNull();
      expect(el?.style.height).toBe('6882px');
      return el!;
    });
    expect(getIndexMock).toHaveBeenCalledTimes(1);
    expect(track.querySelectorAll(':scope > section')).toHaveLength(3);

    const boundary = Array.from(track.children)[2] as HTMLElement;
    expect(boundary.querySelectorAll(':scope > section')).toHaveLength(2);
    const dayEls = Array.from(boundary.querySelectorAll<HTMLElement>(':scope > section'));
    expect(dayEls[0]?.style.height).toBe('673px');
    expect(dayEls[0]?.querySelector('.fixed-row-gallery')).not.toBeNull();
    expect(dayEls[1]?.style.height).toBe('265px');
    expect(dayEls[1]?.querySelector('.fixed-row-gallery')).toBeNull();
  });
});

describe('TimelineGrid day memory', () => {
  const STORAGE_KEY = 'photox.timeline.day';
  const layout = buildBuckets(LAYOUT_ITEMS, LAYOUT_OPTIONS);

  beforeEach(() => {
    stubTimelineData();
    // the scroll handler schedules through rAF; run it inline so the test needs no frame timing
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    sessionStorage.clear();
    resetDayMemory(); // each test is its own document load
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('restores the remembered day on a reload, then starts a same-document visit at the top', async () => {
    sessionStorage.setItem(STORAGE_KEY, '2025-12-15');
    const first = fakeScroller();
    const expected = dayContentY(layout, '2025-12-15');
    expect(expected).not.toBeNull(); // guard: the fixture must contain the remembered day

    renderWithScroller(first.ref, true);

    await waitFor(() =>
      expect(first.scrollTo).toHaveBeenCalledWith({ top: expected, behavior: 'instant' }),
    );
    expect(first.ref.current?.scrollTop).toBe(expected);

    // away and back to the timeline: same document, so the day is not restored — latest first
    cleanup();
    const second = fakeScroller();
    renderWithScroller(second.ref, true);
    await waitFor(() =>
      expect(second.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' }),
    );
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('2026-03-20'); // landing at the top re-remembers it
  });

  it('remembers the day under the sticky header while scrolling', async () => {
    const { ref } = fakeScroller();
    const { container } = renderWithScroller(ref, true);
    // wait for the measured layout: the restore path is a no-op, so only `measured` gates the save
    await waitForTrack(container, layout.totalHeight);

    const target = dayContentY(layout, '2025-10-15');
    expect(target).not.toBeNull();
    ref.current.scrollTop = target! + 10;
    act(() => {
      ref.current.dispatchEvent(new Event('scroll'));
    });

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('2025-10-15');
  });

  it('leaves sessionStorage alone when the grid does not opt in', async () => {
    const { ref } = fakeScroller();
    const { container } = renderWithScroller(ref, false);
    await waitForTrack(container, layout.totalHeight);

    ref.current.scrollTop = 1000;
    act(() => {
      ref.current.dispatchEvent(new Event('scroll'));
    });

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps the sticky day fixed when a window above the viewport gains assets on refresh', async () => {
    const { ref } = fakeScroller();
    const { container } = renderWithScroller(ref, false);
    await waitForTrack(container, layout.totalHeight);

    // park the viewport inside a lower month
    const anchorDay = '2025-12-15';
    const anchorY = dayContentY(layout, anchorDay);
    expect(anchorY).not.toBeNull();
    ref.current.scrollTop = anchorY! + 10;

    // a pre-existing month above the viewport gains a day; its index version moves with it
    const march = windows.get('2026-03');
    expect(march).toBeDefined();
    const added: TimelineItem[] = [
      { t: '2026-03-25T12:00:00', w: 1920, h: 1080 },
      { t: '2026-03-25T12:00:00', w: 1920, h: 1080 },
    ];
    march!.items = [...march!.items, ...added];
    march!.version = 'bumped';

    act(() => useAppStore.getState().bumpTimelineRefresh());

    const next = buildBuckets([...LAYOUT_ITEMS, ...added], LAYOUT_OPTIONS);
    await waitForTrack(container, next.totalHeight);

    // guard: the anchor day really moved in content space, or the assertion below is vacuous
    expect(dayContentY(next, anchorDay)).not.toBe(anchorY);
    // same 10px into the day, i.e. the sticky day did not move under the header
    expect(ref.current?.scrollTop).toBe(dayContentY(next, anchorDay)! + 10);
  });
});
