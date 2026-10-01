import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'

const listPersonsMock = vi.hoisted(() => vi.fn())

vi.mock('../../../api/persons', () => ({ listPersons: listPersonsMock }))
vi.mock('../../../api/faces', () => ({ assignFace: vi.fn() }))
vi.mock('../../FaceThumb', () => ({
  FaceThumb: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

import { FacesSection } from './FacesSection'

const asset = {
  id: 'a1',
  faceStatus: 'ready',
  faces: [
    {
      id: 'face-1',
      assetId: 'a1',
      box: { x: 0, y: 0, w: 10, h: 10 },
      confidence: 0.9,
      personId: 'person-1',
    },
    {
      id: 'face-2',
      assetId: 'a1',
      box: { x: 20, y: 20, w: 10, h: 10 },
      confidence: 0.5,
      personId: null,
    },
  ],
} as unknown as Asset

beforeEach(() => {
  listPersonsMock.mockResolvedValue({
    items: [{ id: 'person-1', name: 'Ada', clusterLabel: null, coverFaceId: 'cover-1' }],
    total: 1,
    limit: 200,
    offset: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FacesSection face hover', () => {
  it("reports the row's own face id on thumbnail hover, not the cluster cover", async () => {
    const onFaceHover = vi.fn()
    render(<FacesSection asset={asset} onFaceHover={onFaceHover} />)

    fireEvent.mouseOver(await screen.findByAltText('Ada'))

    expect(onFaceHover).toHaveBeenCalledWith('face-1')
    expect(onFaceHover).not.toHaveBeenCalledWith('cover-1')
  })

  it('clears the hover when the pointer leaves the thumbnail', async () => {
    const onFaceHover = vi.fn()
    render(<FacesSection asset={asset} onFaceHover={onFaceHover} />)

    const thumb = await screen.findByAltText('Ada')
    fireEvent.mouseOver(thumb)
    fireEvent.mouseOut(thumb)

    expect(onFaceHover).toHaveBeenLastCalledWith(null)
  })

  it('reports unassigned rows too (their slot has no thumbnail)', async () => {
    const onFaceHover = vi.fn()
    const { container } = render(<FacesSection asset={asset} onFaceHover={onFaceHover} />)
    await screen.findByAltText('Ada')

    const rows = container.querySelectorAll('li')
    fireEvent.mouseOver(rows[1]?.children[1] as HTMLElement)

    expect(onFaceHover).toHaveBeenCalledWith('face-2')
  })
})
