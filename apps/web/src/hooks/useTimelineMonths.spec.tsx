import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'

vi.mock('../api/assets', () => ({
  listAllAssets: vi.fn(),
}))

import { useTimelineMonths } from './useTimelineMonths'
import { listAllAssets } from '../api/assets'
import { monthKeyOf, monthRange } from '../lib/dateFormat'
import { useAppStore } from '../store/app-store'

const listAllAssetsMock = vi.mocked(listAllAssets)

function makeAsset(id: string, date: string): Asset {
  return { id, kind: 'photo', takenAt: date, uploadedAt: date, width: null, height: null } as Asset
}

describe('monthKeyOf / monthRange', () => {
  it('maps a month key to local-midnight half-open [from, to) instants', () => {
    const { dateFrom, dateTo } = monthRange('2024-03')
    expect(dateFrom).toBe(new Date(2024, 2, 1).toISOString())
    expect(dateTo).toBe(new Date(2024, 3, 1).toISOString())
    expect(new Date(dateFrom).getTime()).toBeLessThan(new Date(dateTo).getTime())
    // local midnight: an implementation using 'YYYY-MM-01T00:00:00Z' lands at the wrong local
    // hour in every non-UTC timezone and shifts the boundary across DST transitions
    expect(new Date(dateFrom).getHours()).toBe(0)
    expect(new Date(dateFrom).getDate()).toBe(1)
  })

  it('is half-open and contiguous across year edges', () => {
    expect(monthRange('2023-12').dateTo).toBe(monthRange('2024-01').dateFrom)
    expect(monthRange('2023-12').dateFrom).toBe(new Date(2023, 11, 1).toISOString())
    expect(monthRange('2024-12').dateTo).toBe(new Date(2025, 0, 1).toISOString())
  })

  it('monthKeyOf follows the local calendar month of an instant', () => {
    expect(monthKeyOf('2024-03-31T12:00:00')).toBe('2024-03')
    expect(monthKeyOf('2024-01-01T00:15:00')).toBe('2024-01')
    // near a UTC-day boundary: the key must come from the LOCAL date, not the UTC one
    const instant = '2024-03-31T19:00:00.000Z'
    const local = new Date(instant)
    expect(monthKeyOf(instant)).toBe(
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`,
    )
  })

  it('rejects malformed month keys', () => {
    expect(() => monthRange('nope')).toThrow()
    expect(() => monthRange('2024-13')).toThrow()
  })
})

describe('useTimelineMonths', () => {
  beforeEach(() => {
    listAllAssetsMock.mockReset()
    useAppStore.setState({ timelineRefreshKey: 0 })
  })

  it('fetches a month once for concurrent ensureMonth calls and day-groups the result', async () => {
    listAllAssetsMock.mockResolvedValue([makeAsset('a', '2024-05-10T10:00:00Z')])
    const { result } = renderHook(() => useTimelineMonths())

    let first: Promise<Asset[] | null> | undefined
    let second: Promise<Asset[] | null> | undefined
    act(() => {
      first = result.current.ensureMonth('2024-05')
      second = result.current.ensureMonth('2024-05')
    })
    await act(async () => {
      await Promise.all([first, second])
    })

    // in-flight dedupe: one request, scoped to the month's half-open range
    expect(listAllAssetsMock).toHaveBeenCalledTimes(1)
    expect(listAllAssetsMock).toHaveBeenCalledWith({
      limit: 100,
      dateFrom: new Date(2024, 4, 1).toISOString(),
      dateTo: new Date(2024, 5, 1).toISOString(),
    })
    expect(result.current.monthStatus.get('2024-05')).toBe('ready')
    expect(result.current.groups.map((g) => g.sortKey)).toEqual(['2024-05-10'])

    // cached month: no refetch
    await act(async () => {
      await result.current.ensureMonth('2024-05')
    })
    expect(listAllAssetsMock).toHaveBeenCalledTimes(1)
  })

  it('keeps serving cached items across a refresh-key bump, then refetches the month', async () => {
    listAllAssetsMock.mockResolvedValue([makeAsset('a', '2024-05-10T10:00:00Z')])
    const { result } = renderHook(() => useTimelineMonths())
    await act(async () => {
      await result.current.ensureMonth('2024-05')
    })
    expect(listAllAssetsMock).toHaveBeenCalledTimes(1)

    listAllAssetsMock.mockClear()
    // bump: the entry goes stale, but its items stay visible so the viewer doesn't unmount
    act(() => {
      useAppStore.setState({ timelineRefreshKey: 1 })
    })
    expect(result.current.refreshKey).toBe(1)
    expect(result.current.groups).toHaveLength(1)

    listAllAssetsMock.mockResolvedValue([makeAsset('b', '2024-05-20T10:00:00Z')])
    await act(async () => {
      await result.current.ensureMonth('2024-05')
    })
    expect(listAllAssetsMock).toHaveBeenCalledTimes(1)
    expect(result.current.groups.flatMap((g) => g.items).map((a) => a.id)).toEqual(['b'])
  })

  it('drops a fetch that resolves after the refresh key bumped (per-key staleness guard)', async () => {
    let resolveStale!: (value: unknown) => void
    listAllAssetsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        }) as never,
    )
    const { result } = renderHook(() => useTimelineMonths())
    let stalePromise!: Promise<Asset[] | null>
    act(() => {
      stalePromise = result.current.ensureMonth('2024-05')
    })

    act(() => {
      useAppStore.setState({ timelineRefreshKey: 1 })
    })

    // the bump mid-flight: the next ensureMonth starts a fresh fetch instead of joining the stale one
    listAllAssetsMock.mockResolvedValueOnce([makeAsset('fresh', '2024-05-10T10:00:00Z')])
    await act(async () => {
      await result.current.ensureMonth('2024-05')
    })
    expect(listAllAssetsMock).toHaveBeenCalledTimes(2)

    // stale fetch finishes with old data → dropped entirely
    await act(async () => {
      resolveStale([makeAsset('stale', '2024-05-11T10:00:00Z')])
      await stalePromise
    })
    expect(result.current.groups.flatMap((g) => g.items).map((a) => a.id)).toEqual(['fresh'])
  })

  it('resolves null instead of rejecting when the month fetch fails', async () => {
    listAllAssetsMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTimelineMonths())
    let out: Asset[] | null = undefined as never
    await act(async () => {
      out = await result.current.ensureMonth('2024-05')
    })
    expect(out).toBeNull()
    expect(result.current.monthStatus.get('2024-05')).toBe('error')
  })
})
