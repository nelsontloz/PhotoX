import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useSearchParams } from 'react-router-dom'

// Every endpoint the five panels touch stays pending: these tests are about tab chrome and URL
// sync, so each section just sits in its loading skeleton instead of asserting data states.
const api = vi.hoisted(() => {
  const pending = () => new Promise(() => undefined)
  return {
    getAdminLibraryStats: vi.fn(pending),
    getAdminAssetCounts: vi.fn(pending),
    getFaceDetection: vi.fn(pending),
    setFaceDetector: vi.fn(pending),
    reclusterFaces: vi.fn(pending),
    reprocessPipeline: vi.fn(pending),
    getPipelineStatus: vi.fn(pending),
    reprocessThumbnails: vi.fn(pending),
    cleanupOrphans: vi.fn(pending),
    getOrphanCounts: vi.fn(pending),
    listAdminUsers: vi.fn(pending),
    getBackupStatus: vi.fn(pending),
    getBackupOverview: vi.fn(pending),
    getBackupProgress: vi.fn(pending),
    backupUser: vi.fn(pending),
    backupPrefixPreview: vi.fn(() => 'backups/preview/'),
  }
})

vi.mock('../../api/admin', () => api)

import { AdminPageContent } from './index'

function SearchProbe() {
  const [params] = useSearchParams()
  return <output aria-label="tab param">{params.get('tab') ?? 'none'}</output>
}

function renderAdmin(entry: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element: (
          <>
            <SearchProbe />
            <AdminPageContent />
          </>
        ),
      },
    ],
    { initialEntries: [entry] },
  )
  render(<RouterProvider router={router} />)
  return router
}

const selectedTab = () => screen.getByRole('tab', { selected: true })
const tabParam = () => screen.getByLabelText('tab param').textContent

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('admin tabs', () => {
  it('defaults to Overview and leaves the URL without a tab param', () => {
    renderAdmin('/admin')

    expect(selectedTab().textContent).toBe('Overview')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('admin-tab-overview')
    expect(screen.getByRole('heading', { name: 'Library stats' })).toBeTruthy()
    expect(tabParam()).toBe('none')
  })

  it('writes ?tab= on click and swaps the panel content', () => {
    renderAdmin('/admin')

    fireEvent.click(screen.getByRole('tab', { name: 'AI Pipelines' }))

    expect(tabParam()).toBe('ai')
    expect(selectedTab().textContent).toBe('AI Pipelines')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('admin-tab-ai')
    expect(
      screen.getByRole('heading', { name: 'Machine Learning Models & Inference' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Library stats' })).toBeNull()
  })

  it('supports arrow/Home/End keys with a roving tabindex', () => {
    renderAdmin('/admin')

    const overview = screen.getByRole('tab', { name: 'Overview' })
    expect(overview.getAttribute('tabindex')).toBe('0')
    overview.focus()

    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    const ai = screen.getByRole('tab', { name: 'AI Pipelines' })
    expect(selectedTab()).toBe(ai)
    expect(document.activeElement).toBe(ai)
    expect(ai.getAttribute('tabindex')).toBe('0')
    expect(overview.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(ai, { key: 'End' })
    expect(selectedTab().textContent).toBe('Backups')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Backups' }), { key: 'ArrowRight' })
    expect(selectedTab().textContent).toBe('Overview')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'Home' })
    expect(selectedTab().textContent).toBe('Overview')
  })

  it('falls back to Overview for an unknown ?tab= and repairs the URL in place', async () => {
    renderAdmin('/admin?tab=not-a-tab')

    expect(selectedTab().textContent).toBe('Overview')
    await waitFor(() => expect(tabParam()).toBe('overview'))
  })

  it('walks back and forward through tab changes', async () => {
    const router = renderAdmin('/admin')

    fireEvent.click(screen.getByRole('tab', { name: 'Users' }))
    expect(tabParam()).toBe('users')

    await act(async () => {
      await router.navigate(-1)
    })
    expect(tabParam()).toBe('none')
    expect(selectedTab().textContent).toBe('Overview')

    await act(async () => {
      await router.navigate(1)
    })
    expect(tabParam()).toBe('users')
    expect(selectedTab().textContent).toBe('Users')
  })
})
