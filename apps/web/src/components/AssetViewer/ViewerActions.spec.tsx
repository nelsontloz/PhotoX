import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'
import { ViewerActions } from './ViewerActions'
import { preflightFileDownload } from '../../api/assets'

vi.mock('../../api/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/assets')>()
  return { ...actual, preflightFileDownload: vi.fn() }
})

function makeAsset(): Asset {
  return {
    id: 'asset-1',
    fileId: 'file-1',
    kind: 'photo',
    uploadedAt: '2024-01-01T00:00:00Z',
    originalName: 'Trip.jpg',
  } as Asset
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('ViewerActions download', () => {
  it('preflights, then clicks a native anchor at the download URL', async () => {
    vi.mocked(preflightFileDownload).mockResolvedValue(undefined)
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<ViewerActions asset={makeAsset()} />)
    fireEvent.click(screen.getByTitle('Download'))

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1))
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.getAttribute('href')).toBe('/api/v1/files/file-1/download')
    expect(anchor.download).toBe('Trip.jpg')
    expect(preflightFileDownload).toHaveBeenCalledWith('file-1')
  })

  it('never starts a download when the preflight rejects', async () => {
    vi.mocked(preflightFileDownload).mockRejectedValue(new Error('401'))
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<ViewerActions asset={makeAsset()} />)
    fireEvent.click(screen.getByTitle('Download'))

    await vi.waitFor(() => expect(preflightFileDownload).toHaveBeenCalledWith('file-1'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
