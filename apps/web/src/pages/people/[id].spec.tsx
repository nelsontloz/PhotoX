import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Asset, PersonDto } from '@photox/shared-types';
import { groupDateSortKey } from '../../lib/dateFormat';

const usePersonDetailMock = vi.hoisted(() => vi.fn());
const useTimelineViewMock = vi.hoisted(() => vi.fn());
const retryMock = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/usePersonDetail', () => ({ usePersonDetail: usePersonDetailMock }));
vi.mock('../../hooks/useTimelineView', () => ({ useTimelineView: useTimelineViewMock }));
vi.mock('../../hooks/useInlineRename', () => ({
  useInlineRename: () => ({
    editing: false,
    nameValue: '',
    setNameValue: vi.fn(),
    start: vi.fn(),
    save: vi.fn(),
  }),
}));
vi.mock('../../api/persons', () => ({ renamePerson: vi.fn() }));
vi.mock('../../components/AppShell', async () => {
  const { createContext } = await import('react');
  return {
    AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
    ScrollContainerContext: createContext(null),
    useScrollContainer: () => null,
  };
});
vi.mock('../../components/ViewerHost', () => ({ ViewerHost: () => null }));

import PersonDetailPage from './[id]';

const person = {
  id: 'p-1',
  name: 'Ada Lovelace',
  faceCount: 3,
} as PersonDto;

const idleHook = {
  person: null,
  setPerson: vi.fn(),
  loading: true,
  error: null,
  notFound: false,
  retry: retryMock,
};

// jsdom has no IntersectionObserver; the person grid's real AssetThumb registers one on mount (it
// never becomes visible here, so the thumb download path is never reached).
class IOStub {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

const emptyView = {
  timeline: { loading: false, error: null, layout: { buckets: [], totalHeight: 0 } },
  months: { groups: [], monthStatus: new Map(), ensureMonth: vi.fn(), retainMonths: vi.fn() },
  loadedAssets: [],
};

function renderPerson() {
  return render(
    <MemoryRouter initialEntries={['/people/p-1']}>
      <Routes>
        <Route path="/people/:id" element={<PersonDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IOStub);
  useTimelineViewMock.mockReturnValue(emptyView);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('PersonDetailPage person states', () => {
  it('renders ErrorState with retry on a load error (500/network/403)', async () => {
    usePersonDetailMock.mockReturnValue({
      ...idleHook,
      loading: false,
      error: 'Failed to load person',
    });
    renderPerson();

    expect(await screen.findByText('Failed to load person')).toBeTruthy();
    expect(screen.queryByText('Person not found')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryMock).toHaveBeenCalledOnce();
  });

  it('renders not-found only for a 404, with no retry', async () => {
    usePersonDetailMock.mockReturnValue({ ...idleHook, loading: false, notFound: true });
    renderPerson();

    expect(await screen.findByText('Person not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('renders the person once loaded', async () => {
    usePersonDetailMock.mockReturnValue({ ...idleHook, loading: false, person });
    renderPerson();

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  });

  it('renders the Today day header with no face-box overlay on the person grid', async () => {
    const sortKey = groupDateSortKey(new Date().toISOString());
    const monthKey = sortKey.slice(0, 7);
    const asset = {
      id: 'a-1',
      kind: 'photo',
      width: 4,
      height: 3,
      faceCount: null,
    } as Asset;
    usePersonDetailMock.mockReturnValue({ ...idleHook, loading: false, person });
    useTimelineViewMock.mockReturnValue({
      timeline: {
        loading: false,
        error: null,
        measured: true,
        containerRef: vi.fn(),
        layout: {
          buckets: [
            {
              key: monthKey,
              top: 0,
              height: 120,
              days: [{ sortKey, top: 0, height: 120, items: [] }],
            },
          ],
          totalHeight: 120,
        },
      },
      months: {
        groups: [{ label: 'Today', sortKey, items: [asset] }],
        monthStatus: new Map([[monthKey, 'ready']]),
        ensureMonth: vi.fn(),
        retainMonths: vi.fn(),
      },
      loadedAssets: [asset],
    });
    renderPerson();

    expect(await screen.findByRole('heading', { level: 2, name: 'Today' })).toBeTruthy();
    const tile = screen.getByTestId('gallery-item');
    expect(within(tile).queryByTestId('face-box')).toBeNull();
    expect(screen.queryByTestId('face-box')).toBeNull();
  });
});
