import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Asset } from '@photox/shared-types';
import { useSearchStore } from '../../store/search-store';

const searchAssetsMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/assets', () => ({ searchAssets: searchAssetsMock }));
vi.mock('../../components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
  useScrollContainer: () => null,
}));
vi.mock('../../components/ViewerHost', () => ({ ViewerHost: () => null }));

import SearchPage from './index';
import { ConfirmProvider } from '../../components/ConfirmProvider';

// jsdom has no IntersectionObserver; GalleryItem's AssetThumb registers one on mount (it never
// becomes visible here, so the thumb download path is never reached).
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

const asset = {
  id: 'a-1',
  kind: 'photo',
  width: 4,
  height: 3,
  faceCount: null,
} as Asset;

const renderSearch = () =>
  render(
    <MemoryRouter initialEntries={['/search?q=cats']}>
      <ConfirmProvider>
        <SearchPage />
      </ConfirmProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  useSearchStore.getState().reset();
  vi.stubGlobal('IntersectionObserver', IOStub);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('SearchPage tri-state', () => {
  it('renders the ready state with the result count', async () => {
    searchAssetsMock.mockResolvedValue({ items: [asset], total: 1 });
    renderSearch();

    expect(await screen.findByRole('heading', { name: 'Results for “cats”' })).toBeTruthy();
    expect(await screen.findByText('1 item')).toBeTruthy();
    expect(screen.getByTestId('gallery-item')).toBeTruthy();
    expect(searchAssetsMock).toHaveBeenCalledWith({ q: 'cats', limit: 50, offset: 0 });
  });

  it('renders the empty state when the search returns nothing', async () => {
    searchAssetsMock.mockResolvedValue({ items: [], total: 0 });
    renderSearch();

    expect(await screen.findByRole('heading', { name: 'No results for “cats”' })).toBeTruthy();
    expect(screen.getByText('Try a different word or check the spelling.')).toBeTruthy();
    expect(screen.queryByTestId('gallery-item')).toBeNull();
  });

  it('renders the not-ready state when the index answers 503', async () => {
    searchAssetsMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503 },
      message: 'Service Unavailable',
    });
    renderSearch();

    expect(
      await screen.findByText(
        'Search is not ready yet. The search index is still being built — try again in a moment.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByTestId('gallery-item')).toBeNull();
  });
});
