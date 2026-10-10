import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Asset, SearchResponse } from '@photox/shared-types'

vi.mock('../../api/related', () => ({
  getSimilarAssets: vi.fn(),
  getAssetDuplicates: vi.fn(),
}))

import { getSimilarAssets } from '../../api/related'
import { useSimilarAssets } from './useRelatedAssets'

const getSimilarMock = vi.mocked(getSimilarAssets)

function makeAsset(id: string): Asset {
  return { id, kind: 'photo' } as Asset
}

const response = (...ids: string[]): SearchResponse => ({
  items: ids.map(makeAsset),
  total: ids.length,
})

beforeEach(() => {
  getSimilarMock.mockReset()
})

describe('useSimilarAssets', () => {
  it('serves the previous asset’s results while the next asset loads (no blank flash)', async () => {
    getSimilarMock.mockResolvedValueOnce(response('s1', 's2'))
    const { result, rerender } = renderHook(({ id }) => useSimilarAssets(id), {
      initialProps: { id: 'asset-a' },
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.items.map((a) => a.id)).toEqual(['s1', 's2'])

    // next click: the new fetch stays pending, stale results must remain mounted
    getSimilarMock.mockImplementationOnce(() => new Promise(() => undefined))
    rerender({ id: 'asset-b' })
    expect(result.current.status).toBe('loading')
    expect(result.current.items.map((a) => a.id)).toEqual(['s1', 's2'])

    // once the new fetch lands, it swaps in
    getSimilarMock.mockResolvedValueOnce(response('s3'))
    const { result: fresh } = renderHook(({ id }) => useSimilarAssets(id), {
      initialProps: { id: 'asset-c' },
    })
    await waitFor(() => expect(fresh.current.status).toBe('ready'))
    expect(fresh.current.items.map((a) => a.id)).toEqual(['s3'])
  })

  it('reports idle without fetching when disabled', () => {
    const { result } = renderHook(() => useSimilarAssets('asset-d', false))
    expect(result.current).toEqual({ status: 'idle', items: [], total: 0 })
    expect(getSimilarMock).not.toHaveBeenCalled()
  })
})
