import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { AssetDetectionDto } from '@photox/shared-types'

vi.mock('../../api/detections', () => ({ getAssetDetections: vi.fn() }))

import { getAssetDetections } from '../../api/detections'
import { useDetections } from './useDetections'

const getDetectionsMock = vi.mocked(getAssetDetections)

const dog: AssetDetectionDto = { label: 'dog', confidence: 0.9, box: { x: 1, y: 2, w: 3, h: 4 } }

describe('useDetections', () => {
  beforeEach(() => {
    getDetectionsMock.mockReset()
  })

  it('does not fetch until the toggle is enabled', async () => {
    getDetectionsMock.mockResolvedValue({ detections: [dog] })
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDetections('asset-lazy', enabled),
      { initialProps: { enabled: false } },
    )

    expect(result.current.status).toBe('idle')
    expect(getDetectionsMock).not.toHaveBeenCalled()

    rerender({ enabled: true })
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(getDetectionsMock).toHaveBeenCalledTimes(1)
    expect(result.current.detections).toEqual([dog])
  })

  it('serves the session cache on a later mount without refetching', async () => {
    getDetectionsMock.mockResolvedValue({ detections: [dog] })
    const first = renderHook(() => useDetections('asset-cached', true))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    first.unmount()

    const second = renderHook(() => useDetections('asset-cached', true))
    await waitFor(() => expect(second.result.current.status).toBe('ready'))
    expect(second.result.current.detections).toEqual([dog])
    expect(getDetectionsMock).toHaveBeenCalledTimes(1)
  })

  it('treats a failed fetch as a silent empty result', async () => {
    getDetectionsMock.mockRejectedValue({ isAxiosError: true, response: { status: 404 } })
    const { result } = renderHook(() => useDetections('asset-missing', true))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.detections).toEqual([])
  })
})
