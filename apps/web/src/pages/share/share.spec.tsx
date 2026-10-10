import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { PublicShareAsset, PublicShareResponse } from '@photox/shared-types'
import PublicSharePage from './[token]'

// video.js can't run in jsdom — assert the props the page hands it instead.
vi.mock('../../components/VideoPlayer', () => ({
  VideoPlayer: ({
    src,
    type,
    aspectRatio,
  }: {
    src: string
    type?: string
    aspectRatio?: number
  }) => (
    <div data-testid="player" data-src={src} data-type={type ?? ''} data-ar={aspectRatio ?? ''} />
  ),
}))

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../api/client', () => ({ api: { get: mocks.get } }))

const videoAsset = (overrides: Partial<PublicShareAsset> = {}): PublicShareAsset => ({
  id: 'a1',
  userId: 'u1',
  kind: 'video',
  fileId: 'original-file',
  transcodeFileId: null,
  title: null,
  originalName: 'clip.mov',
  mimeType: 'video/quicktime',
  width: 1920,
  height: 1080,
  durationSeconds: 12,
  takenAt: null,
  ...overrides,
})

const assetShare = (asset: PublicShareAsset): PublicShareResponse => ({
  kind: 'asset',
  share: {
    id: 's1',
    kind: 'asset',
    userId: 'u1',
    token: 'tok',
    assetId: asset.id,
    assetFileId: asset.fileId,
    assetThumbFileId: null,
    assetKind: 'video',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  asset,
})

const albumShare: PublicShareResponse = {
  kind: 'album',
  share: {
    id: 's2',
    kind: 'album',
    userId: 'u1',
    token: 'tok',
    albumId: 'al1',
    albumName: 'Trip',
    albumAssetCount: 1,
    albumCoverThumbFileId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  album: { id: 'al1', name: 'Trip', description: null, assetCount: 1 },
}

function renderShare() {
  return render(
    <MemoryRouter initialEntries={['/share/tok']}>
      <Routes>
        <Route path="/share/:token" element={<PublicSharePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('public share page video playback', () => {
  beforeEach(() => {
    mocks.get.mockReset()
  })
  afterEach(cleanup)

  it('asks the player for the webm transcode when the video has one', async () => {
    mocks.get.mockResolvedValue({
      data: assetShare(videoAsset({ transcodeFileId: 'transcoded-file' })),
    })

    renderShare()

    const player = await screen.findByTestId('player')
    expect(player.getAttribute('data-src')).toBe('/api/share/tok/stream')
    expect(player.getAttribute('data-type')).toBe('video/webm')
    // portrait videos get a portrait frame instead of a 16:9 letterbox
    expect(player.getAttribute('data-ar')).toBe(String(1920 / 1080))
  })

  it('falls back to the original mime type for untranscoded videos', async () => {
    mocks.get.mockResolvedValue({ data: assetShare(videoAsset()) })

    renderShare()

    const player = await screen.findByTestId('player')
    expect(player.getAttribute('data-type')).toBe('video/quicktime')
  })

  it('plays an album video member as webm when a transcode exists', async () => {
    const asset = videoAsset({ transcodeFileId: 'transcoded-file' })
    mocks.get.mockImplementation((url: string) => {
      if (url === '/share/tok') return Promise.resolve({ data: albumShare })
      if (url === '/share/tok/assets') return Promise.resolve({ data: { items: [asset] } })
      throw new Error(`unexpected url ${url}`)
    })

    renderShare()

    fireEvent.click(await screen.findByRole('button', { name: 'clip.mov' }))
    await waitFor(() => expect(screen.getByTestId('player')).toBeTruthy())
    const player = screen.getByTestId('player')
    expect(player.getAttribute('data-src')).toBe('/api/share/tok/assets/a1/stream')
    expect(player.getAttribute('data-type')).toBe('video/webm')
  })
})
