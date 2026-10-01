import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FaceDetectionSettings } from '@photox/shared-types'

const { getMock, putMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
  postMock: vi.fn(),
}))

vi.mock('./client', () => ({ api: { get: getMock, put: putMock, post: postMock } }))

import {
  getFaceDetection,
  setFaceDetector,
  reprocessFaces,
  getFaceReprocessStatus,
  reclusterFaces,
} from './admin'

const settings: FaceDetectionSettings = {
  detector: 'human',
  envDefault: 'human',
  models: { scrfd: false },
  facesByDetector: { human: 3, scrfd: 2, unset: 1 },
}

describe('face detection admin API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getFaceDetection reads the face-detection endpoint', async () => {
    getMock.mockResolvedValue({ data: settings })
    await expect(getFaceDetection()).resolves.toEqual(settings)
    expect(getMock).toHaveBeenCalledWith('/v1/admin/face-detection')
  })

  it('setFaceDetector puts the chosen detector and returns the new state', async () => {
    putMock.mockResolvedValue({ data: { ...settings, detector: 'scrfd' } })
    await expect(setFaceDetector('scrfd')).resolves.toEqual({
      ...settings,
      detector: 'scrfd',
    })
    expect(putMock).toHaveBeenCalledWith('/v1/admin/face-detection', { detector: 'scrfd' })
  })

  it('reprocessFaces posts without a body', async () => {
    postMock.mockResolvedValue({ data: { enqueued: 5, total: 5, detector: 'human' } })
    await reprocessFaces()
    expect(postMock).toHaveBeenCalledWith('/v1/admin/faces/reprocess')
  })

  it('getFaceReprocessStatus reads last run and queue counts', async () => {
    const status = {
      lastRun: { startedAt: '2026-10-01T00:00:00.000Z', total: 5, enqueued: 5, detector: 'human' },
      queue: { waiting: 1, active: 0, completed: 4, failed: 0, delayed: 0 },
    }
    getMock.mockResolvedValue({ data: status })
    await expect(getFaceReprocessStatus()).resolves.toEqual(status)
    expect(getMock).toHaveBeenCalledWith('/v1/admin/faces/reprocess')
  })

  it('reclusterFaces posts to the recluster endpoint', async () => {
    postMock.mockResolvedValue({ data: { enqueued: 2 } })
    await expect(reclusterFaces()).resolves.toEqual({ enqueued: 2 })
    expect(postMock).toHaveBeenCalledWith('/v1/admin/faces/recluster')
  })
})
