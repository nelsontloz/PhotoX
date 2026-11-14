import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PersonDto } from '@photox/shared-types';

const api = vi.hoisted(() => ({
  listAllPersons: vi.fn(),
  triggerCluster: vi.fn(),
}));

vi.mock('../../api/persons', () => api);
vi.mock('../../components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import PeoplePage from './index';

const unnamed: PersonDto = {
  id: 'p-1',
  userId: 'u-1',
  name: null,
  coverFaceId: null,
  clusterLabel: null,
  faceCount: 2,
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const renderPeople = () =>
  render(
    <MemoryRouter>
      <PeoplePage />
    </MemoryRouter>,
  );

beforeEach(() => {
  api.listAllPersons.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('PeoplePage', () => {
  it('shows the empty state when no people come back', async () => {
    renderPeople();

    expect(await screen.findByText('No people found')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run clustering' })).toBeTruthy();
  });

  it('renders an unnamed person card with Unknown and its face count', async () => {
    api.listAllPersons.mockResolvedValue([unnamed]);
    renderPeople();

    expect(await screen.findByText('Unknown')).toBeTruthy();
    expect(screen.getByText('2 faces')).toBeTruthy();

    const card = screen.getByRole('link', { name: /Unknown/ });
    expect(card.getAttribute('href')).toBe('/people/p-1');
  });
});
