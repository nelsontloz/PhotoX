import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { FaceDto } from '@photox/shared-types'
import { FaceOverlay } from './FaceOverlay'

const faces: FaceDto[] = [
  {
    id: 'face-1',
    assetId: 'a1',
    box: { x: 0, y: 0, w: 10, h: 10 },
    confidence: 0.9,
    personId: null,
  },
  {
    id: 'face-2',
    assetId: 'a1',
    box: { x: 20, y: 20, w: 10, h: 10 },
    confidence: 0.8,
    personId: 'p1',
  },
]

function boxOf(index: number): HTMLElement {
  const badge = screen.getByText(String(index))
  if (!badge.parentElement) throw new Error(`face ${index} box has no parent`)
  return badge.parentElement
}

afterEach(cleanup)

describe('FaceOverlay', () => {
  it('renders plain amber boxes when nothing is highlighted', () => {
    render(<FaceOverlay faces={faces} imageWidth={100} imageHeight={100} />)

    for (const box of [boxOf(1), boxOf(2)]) {
      expect(box.className).toContain('border-amber-400/80')
      expect(box.className).not.toContain('border-primary')
      expect(box.className).not.toContain('opacity-')
    }
  })

  it('highlights only the matching box and dims the rest', () => {
    render(
      <FaceOverlay faces={faces} imageWidth={100} imageHeight={100} highlightedFaceId="face-2" />,
    )

    expect(boxOf(2).className).toContain('border-primary')
    expect(boxOf(2).className).toContain('z-10')
    expect(boxOf(1).className).toContain('opacity-30')
    expect(boxOf(1).className).not.toContain('border-primary')
  })

  it('ignores a highlighted id that matches no face', () => {
    render(
      <FaceOverlay faces={faces} imageWidth={100} imageHeight={100} highlightedFaceId="nope" />,
    )

    expect(boxOf(1).className).not.toContain('border-primary')
    expect(boxOf(1).className).not.toContain('opacity-')
  })
})
