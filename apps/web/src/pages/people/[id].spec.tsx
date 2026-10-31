import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PersonDto } from '@photox/shared-types';

const usePersonDetailMock = vi.hoisted(() => vi.fn());
const retryMock = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/usePersonDetail', () => ({ usePersonDetail: usePersonDetailMock }));
vi.mock('../../hooks/useTimelineView', () => ({
  useTimelineView: () => ({
    timeline: { loading: false, error: null, layout: { buckets: [] } },
    loadedAssets: [],
  }),
}));
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
vi.mock('../../components/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/Timeline/TimelineAssets', () => ({
  TimelineAssets: () => null,
}));
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

function renderPerson() {
  return render(
    <MemoryRouter initialEntries={['/people/p-1']}>
      <Routes>
        <Route path="/people/:id" element={<PersonDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
});
