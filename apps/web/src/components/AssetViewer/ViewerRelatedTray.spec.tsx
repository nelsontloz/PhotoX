import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'

vi.mock('../AssetThumb', () => ({ AssetThumb: vi.fn(() => null) }))

import { ViewerRelatedTray } from './ViewerRelatedTray'
import type { RelatedAssets } from './useRelatedAssets'

const ready = (items: Asset[], total = items.length): RelatedAssets => ({
  status: 'ready',
  items,
  total,
})
const empty: RelatedAssets = { status: 'ready', items: [], total: 0 }

function makeAsset(id: string, name: string): Asset {
  return { id, kind: 'photo', originalName: name } as Asset
}

afterEach(cleanup)

describe('ViewerRelatedTray', () => {
  it('renders nothing when both sections are empty', () => {
    const { container } = render(
      <ViewerRelatedTray similar={empty} duplicates={empty} onOpenAsset={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing without an open handler', () => {
    const { container } = render(
      <ViewerRelatedTray similar={ready([makeAsset('a', 'a.jpg')])} duplicates={empty} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('hides the duplicates tab when total is 0', () => {
    render(
      <ViewerRelatedTray
        similar={ready([makeAsset('a', 'a.jpg')])}
        duplicates={empty}
        onOpenAsset={vi.fn()}
      />,
    )
    expect(screen.getByText('More like this')).toBeTruthy()
    expect(screen.queryByText('Possible duplicates')).toBeNull()
  })

  it('hides the similar tab when its items are empty, even if total claims otherwise', () => {
    render(
      <ViewerRelatedTray
        similar={{ status: 'ready', items: [], total: 4 }}
        duplicates={ready([makeAsset('d', 'd.jpg')], 1)}
        onOpenAsset={vi.fn()}
      />,
    )
    expect(screen.queryByText('More like this')).toBeNull()
    expect(screen.getByText('Possible duplicates')).toBeTruthy()
  })

  it('expands the active tab to thumbs and count, opens an asset, collapses on re-click', () => {
    const onOpenAsset = vi.fn()
    render(
      <ViewerRelatedTray
        similar={ready([makeAsset('a', 'beach.jpg'), makeAsset('b', 'sunset.jpg')], 2)}
        duplicates={empty}
        onOpenAsset={onOpenAsset}
      />,
    )
    expect(screen.queryByText('2 similar photos')).toBeNull()

    fireEvent.click(screen.getByText('More like this'))
    expect(screen.getByText('2 similar photos')).toBeTruthy()
    fireEvent.click(screen.getByTitle('beach.jpg'))
    expect(onOpenAsset).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))

    fireEvent.click(screen.getByText('More like this'))
    expect(screen.queryByText('2 similar photos')).toBeNull()
  })

  it('shows the duplicates count line when expanded', () => {
    render(
      <ViewerRelatedTray
        similar={empty}
        duplicates={ready([makeAsset('d', 'copy.jpg')], 1)}
        onOpenAsset={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Possible duplicates'))
    expect(screen.getByText('1 possible duplicate')).toBeTruthy()
  })
})
