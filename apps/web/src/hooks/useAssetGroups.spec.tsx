import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'

vi.mock('../api/assets', () => ({
  listAllAssets: vi.fn(),
}))

import { useAssetGroups } from './useAssetGroups'
import { listAllAssets } from '../api/assets'

const listAllAssetsMock = vi.mocked(listAllAssets)

function makeAsset(id: string): Asset {
  return { id, kind: 'photo', uploadedAt: '2024-01-01T00:00:00Z' } as Asset
}

describe('useAssetGroups', () => {
  beforeEach(() => {
    listAllAssetsMock.mockReset()
  })

  it('keeps loading=false while a refresh is in flight', async () => {
    listAllAssetsMock.mockResolvedValue([makeAsset('a')])
    const { result } = renderHook(() => useAssetGroups())

    expect(result.current.loading).toBe(true)
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.groups).toHaveLength(1)

    let resolveRefresh: (value: Asset[]) => void = vi.fn()
    listAllAssetsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )
    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    // ponytail: the page must stay rendered (viewer mounted) during refresh
    expect(result.current.loading).toBe(false)

    await act(async () => {
      resolveRefresh([makeAsset('a')])
      await refreshPromise
    })
    expect(result.current.loading).toBe(false)
  })
})
