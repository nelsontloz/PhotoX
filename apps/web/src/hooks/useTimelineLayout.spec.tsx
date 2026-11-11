import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { AssetLayoutMonth, AssetLayoutPage, User } from '@photox/shared-types';
import type { AssetFilters } from '../api/assets';

vi.mock('../api/assets', () => ({
  getAssetLayoutIndex: vi.fn(),
  getAssetLayoutPage: vi.fn(),
}));

// spy-wrapped real cache: jsdom has no IndexedDB, so the memory fallback is the live cache
vi.mock('../lib/layoutCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/layoutCache')>();
  return {
    ...actual,
    readMonths: vi.fn(actual.readMonths),
    writeMonth: vi.fn(actual.writeMonth),
    pruneExcept: vi.fn(actual.pruneExcept),
  };
});

import { getAssetLayoutIndex, getAssetLayoutPage } from '../api/assets';
import { pruneExcept, readMonths, writeMonth } from '../lib/layoutCache';
import { useAppStore } from '../store/app-store';
import { useAuthStore } from '../store/auth-store';
import { useTimelineLayout } from './useTimelineLayout';

const indexMock = vi.mocked(getAssetLayoutIndex);
const pageMock = vi.mocked(getAssetLayoutPage);
const readMonthsMock = vi.mocked(readMonths);
const writeMonthMock = vi.mocked(writeMonth);
const pruneExceptMock = vi.mocked(pruneExcept);

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface LayoutItem {
  t: string;
  w: number;
  h: number;
}

let months: AssetLayoutMonth[];
let windows: Map<string, { items: LayoutItem[]; version: string }>;
let userId: string;
let userSeq = 0;

function makeMonth(key: string, count: number, version = `v${count}`): AssetLayoutMonth {
  return { key, from: `${key}-from`, to: `${key}-to`, count, version };
}

/** Desc inside the window, like the API: days 20, 19, … */
function makeItems(key: string, count: number): LayoutItem[] {
  return Array.from({ length: count }, (_, i) => ({
    t: `${key}-${String(20 - i).padStart(2, '0')}T12:00:00`,
    w: 1000,
    h: 1000,
  }));
}

function addWindow(key: string, items: LayoutItem[], version = `v${items.length}`): void {
  windows.set(key, { items, version });
  months.push(makeMonth(key, items.length, version));
}

function installApi(): void {
  indexMock.mockImplementation(() => Promise.resolve({ months }));
  pageMock.mockImplementation((params) => {
    const key = params.from.replace(/-from$/, '');
    const win = windows.get(key);
    const items = win?.items ?? [];
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 2000;
    const slice = items.slice(offset, offset + limit);
    const next = offset + slice.length;
    return Promise.resolve({
      from: params.from,
      to: params.to,
      version: win?.version ?? '0',
      total: items.length,
      items: slice,
      nextOffset: next < items.length ? next : null,
    } satisfies AssetLayoutPage);
  });
}

async function renderLoaded(filters: AssetFilters = {}) {
  const rendered = renderHook(() => useTimelineLayout(filters));
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  months = [];
  windows = new Map();
  indexMock.mockReset();
  pageMock.mockReset();
  readMonthsMock.mockClear();
  writeMonthMock.mockClear();
  pruneExceptMock.mockClear();
  installApi();
  useAppStore.setState({ timelineRefreshKey: 0 });
  userId = `layout-user-${++userSeq}`;
  useAuthStore.setState({ user: { id: userId } as User });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useTimelineLayout', () => {
  it('cold load: one index request plus one window request per month', async () => {
    addWindow('2026-03', makeItems('2026-03', 2));
    addWindow('2026-02', makeItems('2026-02', 1));

    const rendered = renderHook(() => useTimelineLayout());
    expect(rendered.result.current.loading).toBe(true); // no complete item set yet
    await waitFor(() => expect(rendered.result.current.loading).toBe(false));
    const { result } = rendered;

    expect(indexMock).toHaveBeenCalledTimes(1);
    expect(indexMock.mock.calls[0]?.[0]).toMatchObject({ tz: TZ });
    expect(pageMock).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.layoutItems.map((item) => item.t)).toEqual([
      '2026-03-20T12:00:00',
      '2026-03-19T12:00:00',
      '2026-02-20T12:00:00',
    ]);
    expect(result.current.layout.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-03',
      '2026-02',
    ]);
    expect(result.current.error).toBeNull();
    expect(writeMonthMock).toHaveBeenCalledTimes(2);
  });

  it('warm load: one index request and zero window requests', async () => {
    addWindow('2026-03', makeItems('2026-03', 2));
    addWindow('2026-02', makeItems('2026-02', 1));

    const first = await renderLoaded();
    first.unmount();
    const { result } = await renderLoaded();

    expect(indexMock).toHaveBeenCalledTimes(2);
    expect(pageMock).toHaveBeenCalledTimes(2); // only the cold load fetched
    expect(result.current.layoutItems).toHaveLength(3);
  });

  it('a version bump refetches only the window that moved', async () => {
    addWindow('2026-03', makeItems('2026-03', 2));
    addWindow('2026-02', makeItems('2026-02', 1));
    const { result } = await renderLoaded();
    const callsBefore = pageMock.mock.calls.length;

    months = [makeMonth('2026-03', 3, 'v3'), makeMonth('2026-02', 1)];
    windows.set('2026-03', { items: makeItems('2026-03', 3), version: 'v3' });
    act(() => useAppStore.getState().bumpTimelineRefresh());

    await waitFor(() => expect(result.current.layoutItems).toHaveLength(4));
    expect(pageMock.mock.calls.length).toBe(callsBefore + 1);
    expect(pageMock.mock.calls.at(-1)?.[0]).toMatchObject({ from: '2026-03-from' });
  });

  it('adds a new window and prunes the one that vanished', async () => {
    addWindow('2026-03', makeItems('2026-03', 2));
    addWindow('2026-02', makeItems('2026-02', 1));
    const { result } = await renderLoaded();
    expect(pageMock).toHaveBeenCalledTimes(2);

    months = [makeMonth('2026-03', 2), makeMonth('2026-01', 1)];
    windows.delete('2026-02');
    windows.set('2026-01', { items: makeItems('2026-01', 1), version: 'v1' });
    act(() => useAppStore.getState().bumpTimelineRefresh());

    await waitFor(() =>
      expect(result.current.layout.buckets.map((bucket) => bucket.key)).toEqual([
        '2026-03',
        '2026-01',
      ]),
    );
    expect(pageMock).toHaveBeenCalledTimes(3); // only the new window
    expect(pageMock.mock.calls.at(-1)?.[0]).toMatchObject({ from: '2026-01-from' });
    expect(pruneExceptMock).toHaveBeenLastCalledWith(userId, '||', ['2026-03', '2026-01']);
    expect((await readMonths(userId, '||', ['2026-02'])).size).toBe(0);
  });

  it('walks nextOffset pages once and restarts a window whose version changed mid-walk', async () => {
    const items = makeItems('2026-03', 2);
    months = [makeMonth('2026-03', 2, 'v1')];
    windows.set('2026-03', { items, version: 'v1' });
    const page = (
      version: string,
      item: LayoutItem,
      nextOffset: number | null,
    ): AssetLayoutPage => ({
      from: '2026-03-from',
      to: '2026-03-to',
      version,
      total: 2,
      items: [item],
      nextOffset,
    });
    const [a, b] = items;
    const script = [
      page('v1', a!, 1),
      page('v2', b!, null), // drifted: restart
      page('v3', a!, 1),
      page('v3', b!, null),
    ];
    pageMock.mockImplementation(() => Promise.resolve(script.shift()!));

    const { result } = await renderLoaded();

    expect(pageMock).toHaveBeenCalledTimes(4);
    expect(result.current.layoutItems.map((item) => item.t)).toEqual([a!.t, b!.t]);
    expect(writeMonthMock).not.toHaveBeenCalled(); // the restart's v3 no longer matches index v1
  });

  it('person views never touch the persistent cache and refetch every window per mount', async () => {
    addWindow('2026-03', makeItems('2026-03', 2));

    const first = await renderLoaded({ personId: 'person-1' });
    expect(indexMock.mock.calls[0]?.[0]).toMatchObject({ personId: 'person-1', tz: TZ });
    expect(readMonthsMock).not.toHaveBeenCalled();
    expect(writeMonthMock).not.toHaveBeenCalled();
    expect(pageMock).toHaveBeenCalledTimes(1);

    first.unmount();
    const second = await renderLoaded({ personId: 'person-1' });
    expect(pageMock).toHaveBeenCalledTimes(2); // refetched, not served from memory
    expect(second.result.current.layoutItems).toHaveLength(2);
  });

  it('re-indexes when the filter changes and never reuses the previous windows', async () => {
    addWindow('2026-03', makeItems('2026-03', 1));
    const view = renderHook(
      ({ personId }: { personId: string }) => useTimelineLayout({ personId }),
      {
        initialProps: { personId: 'person-1' },
      },
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(indexMock.mock.calls[0]?.[0]).toMatchObject({ personId: 'person-1' });

    // person-2 owns a completely different window
    months = [makeMonth('2026-02', 1)];
    windows = new Map([['2026-02', { items: makeItems('2026-02', 1), version: 'v1' }]]);
    view.rerender({ personId: 'person-2' });

    await waitFor(() => expect(view.result.current.layoutItems[0]?.t).toBe('2026-02-20T12:00:00'));
    expect(indexMock).toHaveBeenCalledTimes(2);
    expect(indexMock.mock.calls[1]?.[0]).toMatchObject({ personId: 'person-2' });
    expect(pageMock).toHaveBeenCalledTimes(2); // one window per filter, nothing reused
    expect(view.result.current.layout.buckets.map((bucket) => bucket.key)).toEqual(['2026-02']);
  });

  it('a failing window keeps the previous track and surfaces the page error', async () => {
    addWindow('2026-03', makeItems('2026-03', 2));
    const { result } = await renderLoaded();

    months = [makeMonth('2026-03', 3, 'v3')];
    windows.set('2026-03', { items: makeItems('2026-03', 3), version: 'v3' });
    pageMock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    act(() => useAppStore.getState().bumpTimelineRefresh());

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.layoutItems).toHaveLength(2); // no partial track
    expect(result.current.loading).toBe(false);
  });
});
