import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act, fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import type { Asset } from '@photox/shared-types'

vi.mock('../api/assets', () => ({
  trashAsset: vi.fn(),
  restoreAsset: vi.fn(),
  deleteAsset: vi.fn(),
}))

import { useAssetNavigation } from './useAssetNavigation'
import { deleteAsset, restoreAsset, trashAsset } from '../api/assets'
import { ConfirmProvider } from '../components/ConfirmProvider'

const trashAssetMock = vi.mocked(trashAsset)
const restoreAssetMock = vi.mocked(restoreAsset)
const deleteAssetMock = vi.mocked(deleteAsset)

function makeAsset(id: string): Asset {
  return { id, kind: 'photo' } as Asset
}

function makeWrapper(initialUrl: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </MemoryRouter>
    )
  }
}

describe('useAssetNavigation', () => {
  beforeEach(() => {
    trashAssetMock.mockReset()
    restoreAssetMock.mockReset()
    deleteAssetMock.mockReset()
    vi.stubGlobal('alert', vi.fn())
  })

  it('returns null selected when no asset param', () => {
    const { result } = renderHook(() => useAssetNavigation({ assets: [makeAsset('a')] }), {
      wrapper: makeWrapper('/'),
    })
    expect(result.current.selected).toBeNull()
    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(false)
  })

  it('selects the asset whose id is in the URL', () => {
    const a = makeAsset('a')
    const { result } = renderHook(() => useAssetNavigation({ assets: [a] }), {
      wrapper: makeWrapper('/?asset=a'),
    })
    expect(result.current.selected).toEqual(a)
  })

  it('ignores a stale id that is not in the list', () => {
    const { result } = renderHook(() => useAssetNavigation({ assets: [makeAsset('a')] }), {
      wrapper: makeWrapper('/?asset=missing'),
    })
    expect(result.current.selected).toBeNull()
  })

  it('keeps the selected asset when its month falls out of the loaded list', () => {
    const a = makeAsset('a')
    const b = makeAsset('b')
    const { result, rerender } = renderHook(
      (props: { assets: Asset[] }) => useAssetNavigation(props),
      { initialProps: { assets: [a, b] }, wrapper: makeWrapper('/?asset=a') },
    )
    expect(result.current.selected).toEqual(a)

    rerender({ assets: [] }) // simulated month-cache eviction
    expect(result.current.selected).toEqual(a)
  })

  it('open sets the asset param', () => {
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a] })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/') },
    )
    act(() => result.current.nav.open(a))
    rerender()
    expect(result.current.params.get('asset')).toBe('a')
  })

  it('opens an asset that is not in the loaded list (related strips)', () => {
    const a = makeAsset('a')
    const stray = makeAsset('stray')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a] })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/') },
    )
    act(() => result.current.nav.open(stray))
    rerender()
    expect(result.current.params.get('asset')).toBe('stray')
    expect(result.current.nav.selected?.id).toBe('stray')
  })

  it('keeps open and close identity stable across rerenders', () => {
    const a = makeAsset('a')
    const { result, rerender } = renderHook(() => useAssetNavigation({ assets: [a] }), {
      wrapper: makeWrapper('/'),
    })
    const { open, close } = result.current
    rerender()
    expect(result.current.open).toBe(open)
    expect(result.current.close).toBe(close)
  })

  it('open and close preserve unrelated params (search ?q=)', () => {
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a] })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/search?q=beach') },
    )
    act(() => result.current.nav.open(a))
    rerender()
    expect(result.current.params.get('q')).toBe('beach')
    expect(result.current.params.get('asset')).toBe('a')

    act(() => result.current.nav.close())
    rerender()
    expect(result.current.params.get('q')).toBe('beach')
    expect(result.current.params.get('asset')).toBeNull()
  })

  it('close clears the asset param', () => {
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a] })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/?asset=a') },
    )
    act(() => result.current.nav.close())
    rerender()
    expect(result.current.params.get('asset')).toBeNull()
  })

  it('goPrev and goNext swap the asset param', () => {
    const a = makeAsset('a')
    const b = makeAsset('b')
    const c = makeAsset('c')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a, b, c] })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/?asset=b') },
    )
    expect(result.current.nav.hasPrev).toBe(true)
    expect(result.current.nav.hasNext).toBe(true)

    act(() => result.current.nav.goNext())
    rerender()
    expect(result.current.params.get('asset')).toBe('c')
    expect(result.current.nav.hasNext).toBe(false)

    act(() => result.current.nav.goPrev())
    rerender()
    expect(result.current.params.get('asset')).toBe('b')
  })

  it('restore calls the API, clears the asset param, and invokes onAfterAction', async () => {
    restoreAssetMock.mockResolvedValue(undefined)
    const onAfterAction = vi.fn()
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a], onAfterAction })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/?asset=a') },
    )
    await act(async () => {
      await result.current.nav.restore()
    })
    rerender()
    expect(restoreAssetMock).toHaveBeenCalledWith('a')
    expect(result.current.params.get('asset')).toBeNull()
    expect(onAfterAction).toHaveBeenCalledOnce()
  })

  it('trash confirms, calls the API with the selected id, closes, and refreshes', async () => {
    trashAssetMock.mockResolvedValue(undefined)
    const onAfterAction = vi.fn()
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a], onAfterAction })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/?asset=a') },
    )

    let pending!: Promise<void>
    act(() => {
      pending = result.current.nav.trash()
    })
    const dialog = await screen.findByRole('dialog', { name: 'Move "this photo" to trash?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await act(async () => {
      await pending
    })
    rerender()
    expect(trashAssetMock).toHaveBeenCalledWith('a')
    expect(onAfterAction).toHaveBeenCalledOnce()
    expect(result.current.params.get('asset')).toBeNull()
  })

  it('trash does not call the API when the confirm is declined', async () => {
    const onAfterAction = vi.fn()
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a], onAfterAction })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/?asset=a') },
    )

    let pending!: Promise<void>
    act(() => {
      pending = result.current.nav.trash()
    })
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await act(async () => {
      await pending
    })
    rerender()
    expect(trashAssetMock).not.toHaveBeenCalled()
    expect(onAfterAction).not.toHaveBeenCalled()
    expect(result.current.params.get('asset')).toBe('a')
  })

  it('permanentlyDelete confirms, calls the API with the selected id, closes, and refreshes', async () => {
    deleteAssetMock.mockResolvedValue(undefined)
    const onAfterAction = vi.fn()
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a], onAfterAction })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/?asset=a') },
    )

    let pending!: Promise<void>
    act(() => {
      pending = result.current.nav.permanentlyDelete()
    })
    const dialog = await screen.findByRole('dialog', {
      name: 'Permanently delete "this photo"?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await act(async () => {
      await pending
    })
    rerender()
    expect(deleteAssetMock).toHaveBeenCalledWith('a')
    expect(onAfterAction).toHaveBeenCalledOnce()
    expect(result.current.params.get('asset')).toBeNull()
  })

  it('permanentlyDelete does not call the API when the confirm is declined', async () => {
    const onAfterAction = vi.fn()
    const a = makeAsset('a')
    const { result, rerender } = renderHook(
      () => {
        const nav = useAssetNavigation({ assets: [a], onAfterAction })
        const [params] = useSearchParams()
        return { nav, params }
      },
      { wrapper: makeWrapper('/?asset=a') },
    )

    let pending!: Promise<void>
    act(() => {
      pending = result.current.nav.permanentlyDelete()
    })
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await act(async () => {
      await pending
    })
    rerender()
    expect(deleteAssetMock).not.toHaveBeenCalled()
    expect(onAfterAction).not.toHaveBeenCalled()
    expect(result.current.params.get('asset')).toBe('a')
  })
})
