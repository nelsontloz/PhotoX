import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import type { Asset } from '@photox/shared-types'

vi.mock('../api/assets', () => ({
  trashAsset: vi.fn(),
  restoreAsset: vi.fn(),
}))

import { useAssetNavigation } from './useAssetNavigation'
import { restoreAsset, trashAsset } from '../api/assets'

const trashAssetMock = vi.mocked(trashAsset)
const restoreAssetMock = vi.mocked(restoreAsset)

function makeAsset(id: string): Asset {
  return { id, kind: 'photo' } as Asset
}

function makeWrapper(initialUrl: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
  }
}

describe('useAssetNavigation', () => {
  beforeEach(() => {
    trashAssetMock.mockReset()
    restoreAssetMock.mockReset()
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
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
})
