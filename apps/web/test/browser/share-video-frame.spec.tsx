import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { PublicShareResponse } from '@photox/shared-types'
import '../../src/app.css'

// video.js can't run here — the layout contract under test is the page's size container.
vi.mock('../../src/components/VideoPlayer', () => ({
  VideoPlayer: () => <div data-testid="player" />,
}))

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../src/api/client', () => ({ api: { get: mocks.get } }))

import PublicSharePage from '../../src/pages/share/[token]'

// Real-Chromium lane: the single-share video frame collapsed to 0x0 because the page's
// container-type:size box had only min-height (auto height) — cqh resolves to 0 there. jsdom
// cannot see this; only a real engine computes container query units.
afterEach(cleanup)

const response: PublicShareResponse = {
  kind: 'asset',
  share: {
    id: 's1',
    kind: 'asset',
    userId: 'u1',
    token: 'tok',
    assetId: 'a1',
    assetFileId: 'original-file',
    assetThumbFileId: null,
    assetKind: 'video',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  asset: {
    id: 'a1',
    userId: 'u1',
    kind: 'video',
    fileId: 'original-file',
    transcodeFileId: 'transcoded-file',
    title: null,
    originalName: 'clip.mp4',
    mimeType: 'video/mp4',
    width: 1080,
    height: 1920,
    durationSeconds: 57,
    takenAt: null,
  },
}

describe('public share page video frame (headless Chromium)', () => {
  it('resolves cqh inside the media container so the player frame has a real box', async () => {
    mocks.get.mockResolvedValue({ data: response })

    const view = render(
      <MemoryRouter initialEntries={['/share/tok']}>
        <Routes>
          <Route path="/share/:token" element={<PublicSharePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByTestId('player')

    const root = view.container.firstElementChild as HTMLElement
    expect(getComputedStyle(root).containerType).toBe('size')

    // pre-fix (min-h-screen): the container's height is auto, cqh = 0 and .video-frame is 0x0
    const probe = document.createElement('div')
    probe.style.height = '100cqh'
    root.appendChild(probe)
    expect(probe.getBoundingClientRect().height).toBeGreaterThan(0)
  })
})
