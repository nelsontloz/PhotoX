import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Asset } from '@photox/shared-types'

const api = vi.hoisted(() => ({
  listAllAssets: vi.fn(),
  emptyTrash: vi.fn(),
  restoreAsset: vi.fn(),
  trashAsset: vi.fn(),
  deleteAsset: vi.fn(),
  updateAsset: vi.fn(),
}))

vi.mock('../../api/assets', () => api)

// The auth gate, shell chrome and the real viewer are not this spec's subject: stand them in so the
// page content runs against the mocked api module only (same stub-the-boundary style as FacesSection).
vi.mock('../../components/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../../components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
  useScrollContainer: () => null,
}))
vi.mock('../../components/ViewerHost', () => ({
  ViewerHost: ({ asset, onRestore }: { asset: Asset | null; onRestore?: () => void }) =>
    asset ? (
      <div>
        <p>{asset.title}</p>
        <button type="button" onClick={onRestore}>
          Restore from trash
        </button>
      </div>
    ) : null,
}))

import TrashPage from './index'
import { ConfirmProvider } from '../../components/ConfirmProvider'
import { formatDate } from '../../lib/dateFormat'

const trashedAt = '2020-01-15T12:00:00.000Z'

const makeAsset = (over: Partial<Asset> = {}): Asset =>
  ({
    id: 'a1',
    kind: 'photo',
    title: 'Beach trip',
    isTrashed: true,
    trashedAt,
    ...over,
  }) as Asset

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

const alertMock = vi.fn()

function renderTrash() {
  return render(
    <MemoryRouter>
      <ConfirmProvider>
        <TrashPage />
      </ConfirmProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  api.listAllAssets.mockResolvedValue([])
  vi.stubGlobal('IntersectionObserver', IOStub)
  vi.stubGlobal('alert', alertMock)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('TrashPage', () => {
  it('shows the empty state when no trashed assets come back', async () => {
    renderTrash()

    expect(await screen.findByText('Trash is empty')).toBeTruthy()
    expect(screen.getByText('Photos you delete from your timeline will appear here.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull()
  })

  it('renders the trashed items grouped by trashedAt with the empty-trash action', async () => {
    api.listAllAssets.mockResolvedValue([makeAsset()])
    renderTrash()

    expect(await screen.findByText(formatDate(trashedAt))).toBeTruthy()
    expect(api.listAllAssets).toHaveBeenCalledWith(
      expect.objectContaining({ isTrashed: true, favorite: undefined }),
    )
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeTruthy()
    // the toolbar action plus one GalleryItem (figure with role="button")
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByText('Trash is empty')).toBeNull()
  })

  it('empties the trash after confirmation and refetches', async () => {
    api.listAllAssets.mockResolvedValue([makeAsset()])
    api.emptyTrash.mockResolvedValue(undefined)
    renderTrash()
    await screen.findByText(formatDate(trashedAt))

    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }))
    const dialog = await screen.findByRole('dialog', { name: 'Empty trash?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' }))

    await waitFor(() => expect(api.emptyTrash).toHaveBeenCalledOnce())
    await waitFor(() => expect(api.listAllAssets).toHaveBeenCalledTimes(2))
  })

  it('alerts and keeps the items when emptying fails', async () => {
    api.listAllAssets.mockResolvedValue([makeAsset()])
    api.emptyTrash.mockRejectedValue(new Error('boom'))
    renderTrash()
    await screen.findByText(formatDate(trashedAt))

    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }))
    const dialog = await screen.findByRole('dialog', { name: 'Empty trash?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' }))

    await waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith('Failed to empty trash. Please try again.'),
    )
    expect(api.listAllAssets).toHaveBeenCalledTimes(1)
  })

  it('opens the viewer on item click and restores through it', async () => {
    api.listAllAssets.mockResolvedValue([makeAsset()])
    api.restoreAsset.mockResolvedValue(undefined)
    renderTrash()
    await screen.findByText(formatDate(trashedAt))

    const item = screen.getAllByRole('button').find((el) => el.tagName === 'FIGURE')
    expect(item).toBeTruthy()
    fireEvent.click(item!)

    // the viewer stand-in renders the selected asset; the page wires Restore to nav.restore
    expect(await screen.findByText('Beach trip')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore from trash' }))

    await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(api.listAllAssets).toHaveBeenCalledTimes(2))
  })
})
