import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'

vi.mock('../api/assets', () => ({
  listAssets: vi.fn(),
}))

import { useAssetGroups } from './useAssetGroups'
import { listAssets } from '../api/assets'

const listAssetsMock = vi.mocked(listAssets)

function makeAsset(id: string): Asset {
  return { id, kind: 'photo', uploadedAt: '2024-01-01T00:00:00Z' } as Asset
}

describe('useAssetGroups', () => {
  beforeEach(() => {
    listAssetsMock.mockReset()
  })

  it('keeps loading=false while a refresh is in flight', async () => {
    listAssetsMock.mockResolvedValue({ items: [makeAsset('a')], total: 1, limit: 50, offset: 0 })
    const { result } = renderHook(() => useAssetGroups())

    expect(result.current.loading).toBe(true)
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.groups).toHaveLength(1)

    let resolveRefresh: (value: unknown) => void = vi.fn()
    listAssetsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }) as never,
    )
    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    // ponytail: the page must stay rendered (viewer mounted) during refresh
    expect(result.current.loading).toBe(false)

    await act(async () => {
      resolveRefresh({ items: [makeAsset('a')], total: 1, limit: 50, offset: 0 })
      await refreshPromise
    })
    expect(result.current.loading).toBe(false)
  })
})
