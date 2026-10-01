import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FaceDetectionSettings } from '@photox/shared-types'

const api = vi.hoisted(() => ({
  getFaceDetection: vi.fn(),
  setFaceDetector: vi.fn(),
  reprocessFaces: vi.fn(),
  getFaceReprocessStatus: vi.fn(),
  reclusterFaces: vi.fn(),
}))

vi.mock('../../api/admin', () => api)

import { FaceDetectionSection, FacesReprocessSection } from './index'

const settings = (over: Partial<FaceDetectionSettings> = {}): FaceDetectionSettings => ({
  detector: 'human',
  envDefault: 'human',
  models: { scrfd: false },
  facesByDetector: { human: 0, scrfd: 0, unset: 0 },
  ...over,
})

const drained = {
  lastRun: null,
  queue: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
}

const mixedParagraph = () =>
  screen.queryByText(
    (_content, el) => el?.tagName === 'P' && (el.textContent ?? '').includes('Faces are mixed'),
  )

beforeEach(() => {
  api.getFaceDetection.mockResolvedValue(settings())
  api.getFaceReprocessStatus.mockResolvedValue(drained)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('FaceDetectionSection', () => {
  it('renders the detector radios, disables SCRFD and shows the provisioning hint', async () => {
    render(<FaceDetectionSection />)

    const human = await screen.findByRole<HTMLInputElement>('radio', {
      name: /Human \(BlazeFace\)/,
    })
    const scrfd = screen.getByRole<HTMLInputElement>('radio', { name: /SCRFD 10G/ })

    expect(human.checked).toBe(true)
    expect(scrfd.disabled).toBe(true)
    expect(screen.getByText(/SCRFD model not installed/)).toBeTruthy()
    expect(screen.getByText('pnpm --filter @photox/worker-service face-model')).toBeTruthy()
  })

  it('opens the SCRFD override dialog and PUTs the detector on confirm', async () => {
    api.setFaceDetector.mockResolvedValue(settings({ detector: 'scrfd' }))
    render(<FaceDetectionSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to SCRFD anyway' }))
    expect(screen.getByText('Switch to SCRFD anyway?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Switch anyway' }))

    await waitFor(() => expect(api.setFaceDetector).toHaveBeenCalledWith('scrfd'))
    await screen.findByText(/SCRFD is selected but its model is not installed/)
    expect(screen.queryByRole('button', { name: 'Switch to SCRFD anyway' })).toBeNull()
  })

  it('warns when faces from both detectors are mixed and counts unrecorded ones', async () => {
    api.getFaceDetection.mockResolvedValue(
      settings({
        models: { scrfd: true },
        facesByDetector: { human: 3, scrfd: 2, unset: 1 },
      }),
    )
    const { unmount } = render(<FaceDetectionSection />)
    await screen.findByRole('radio', { name: /Human \(BlazeFace\)/ })

    const warning = mixedParagraph()
    expect(warning).not.toBeNull()
    const text = warning?.textContent ?? ''
    expect(text).toContain('3 with Human (BlazeFace)')
    expect(text).toContain('2 with SCRFD 10G')
    expect(text).toMatch(/1 more faces have no detector\s+recorded\./)

    unmount()
    api.getFaceDetection.mockResolvedValue(
      settings({ models: { scrfd: true }, facesByDetector: { human: 3, scrfd: 0, unset: 0 } }),
    )
    render(<FaceDetectionSection />)
    await screen.findByRole('radio', { name: /Human \(BlazeFace\)/ })
    expect(mixedParagraph()).toBeNull()
  })
})

describe('FacesReprocessSection', () => {
  it('confirms the reprocess dialog, POSTs, then renders polled progress', async () => {
    api.getFaceReprocessStatus.mockResolvedValueOnce(drained).mockResolvedValueOnce({
      lastRun: {
        startedAt: '2026-10-01T00:00:00.000Z',
        total: 5,
        enqueued: 5,
        detector: 'human',
      },
      queue: { waiting: 1, active: 1, completed: 4, failed: 0, delayed: 0 },
    })
    api.reprocessFaces.mockResolvedValue({ enqueued: 5, total: 5, detector: 'human' })

    render(<FacesReprocessSection />)
    await screen.findByText('No face reprocess runs yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess all faces' }))
    expect(screen.getByText('Reprocess all faces?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(api.reprocessFaces).toHaveBeenCalled())
    expect(await screen.findByText('Queued 5 face jobs for 5 photos.')).toBeTruthy()

    // progress counts come from waiting+active, never queue.completed (which is 4 here)
    const bar = await screen.findByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('5')
    expect(screen.getByText('2 of 5 remaining · 60%')).toBeTruthy()
  })

  it('shows the last-run summary when the queue is drained, ignoring queue.completed', async () => {
    api.getFaceReprocessStatus.mockResolvedValue({
      lastRun: {
        startedAt: '2026-10-01T00:00:00.000Z',
        total: 8,
        enqueued: 5,
        detector: 'scrfd',
      },
      queue: { waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 },
    })

    render(<FacesReprocessSection />)

    expect(
      await screen.findByText(/5 of 8 photos\s+queued with the SCRFD 10G detector\./),
    ).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('warns in the confirm dialog when SCRFD is active but unprovisioned, and still allows confirm', async () => {
    api.getFaceDetection.mockResolvedValue(
      settings({ detector: 'scrfd', models: { scrfd: false } }),
    )
    api.reprocessFaces.mockResolvedValue({ enqueued: 5, total: 5, detector: 'scrfd' })

    render(<FacesReprocessSection />)
    await screen.findByText('No face reprocess runs yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess all faces' }))

    expect(
      screen.getByText(
        "The SCRFD model isn't installed — these jobs will fail until it is provisioned.",
      ),
    ).toBeTruthy()
    expect(screen.getByText('pnpm --filter @photox/worker-service face-model')).toBeTruthy()

    // warn, don't block — parity with the "Switch to SCRFD anyway" flow
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.reprocessFaces).toHaveBeenCalled())
  })

  it('shows no SCRFD warning in the confirm dialog when the model is installed', async () => {
    api.getFaceDetection.mockResolvedValue(settings({ detector: 'scrfd', models: { scrfd: true } }))

    render(<FacesReprocessSection />)
    await screen.findByText('No face reprocess runs yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess all faces' }))

    expect(screen.getByText('Reprocess all faces?')).toBeTruthy()
    expect(screen.queryByText(/The SCRFD model isn't installed/)).toBeNull()
    expect(screen.queryByText('pnpm --filter @photox/worker-service face-model')).toBeNull()
  })

  it('reclusters users and renders the queued result', async () => {
    api.reclusterFaces.mockResolvedValue({ enqueued: 2 })

    render(<FacesReprocessSection />)
    await screen.findByText('No face reprocess runs yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Recluster users' }))

    await waitFor(() => expect(api.reclusterFaces).toHaveBeenCalled())
    expect(await screen.findByText('Clustering queued for 2 users.')).toBeTruthy()
  })

  it('renders the recluster empty state when no users have faces', async () => {
    api.reclusterFaces.mockResolvedValue({ enqueued: 0 })

    render(<FacesReprocessSection />)
    await screen.findByText('No face reprocess runs yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Recluster users' }))

    expect(await screen.findByText('Nothing to cluster — no faces yet.')).toBeTruthy()
  })
})
