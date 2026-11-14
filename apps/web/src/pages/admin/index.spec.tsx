import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from '@photox/shared-types';
import { useAuthStore } from '../../store/auth-store';

// The console chrome and the role gate are this spec's subject; every panel would otherwise fetch
// on mount, so they stand in as markers.
vi.mock('../../components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
  useScrollContainer: () => null,
}));
vi.mock('./library-stats', () => ({ LibraryStatsSection: () => <p>library-stats-marker</p> }));
vi.mock('./ai', () => ({
  FacialDetectionCard: () => null,
  EmbeddingsReprocessSection: () => null,
  DetectionsReprocessSection: () => null,
}));
vi.mock('./assets', () => ({
  AssetHealthSection: () => null,
  OrphanCleanupSection: () => null,
}));
vi.mock('./users', () => ({ UsersSection: () => null }));
vi.mock('./backups', () => ({ BackupSection: () => null }));

import AdminPage from './index';

const regularUser = { id: 'u-1', email: 'ada@example.com', role: 'user' } as User;
const adminUser = { ...regularUser, role: 'admin' } as User;

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/" element={<p>home-marker</p>} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
});

describe('AdminPage role gate', () => {
  it('redirects a non-admin visit to /admin back to the home page', async () => {
    useAuthStore.setState({ user: regularUser });
    renderAdmin();

    expect(await screen.findByText('home-marker')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Admin Console' })).toBeNull();
  });

  it('renders the console for an admin', () => {
    useAuthStore.setState({ user: adminUser });
    renderAdmin();

    expect(screen.getByRole('heading', { name: 'Admin Console' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Admin console sections' })).toBeTruthy();
    expect(screen.getByText('library-stats-marker')).toBeTruthy();
    expect(screen.queryByText('home-marker')).toBeNull();
  });
});
