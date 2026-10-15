import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const listAllAssetsMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/assets')>()
  return { ...actual, listAllAssets: listAllAssetsMock }
})

// The auth gate is not this spec's subject: stand it in so the AppShell prop the page
// passes (notably places' mainClassName override) is asserted against the real page.
vi.mock('../../components/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('../../components/AppShell', () => ({
  AppShell: ({ children, mainClassName }: { children: ReactNode; mainClassName?: string }) => (
    <main data-testid="places-shell" className={mainClassName}>
      {children}
    </main>
  ),
}))

import PlacesPage from './index'
import { ConfirmProvider } from '../../components/ConfirmProvider'

beforeEach(() => {
  listAllAssetsMock.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PlacesPage shell', () => {
  it('keeps its own scroll container instead of the default AppShell main', async () => {
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <PlacesPage />
        </ConfirmProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('No photos with location data found')).toBeTruthy()
    expect(screen.getByTestId('places-shell').getAttribute('class')).toBe(
      'flex-1 overflow-hidden relative',
    )
  })
})
