import { describe, it, expect, vi, beforeEach } from 'vitest'
import { of } from 'rxjs'
import { HttpService } from '@nestjs/axios'
import { FaceClusterService } from './face.cluster'
import { BullMqService } from './bullmq.service'

describe('FaceClusterService.cluster', () => {
  const userId = 'user-1'
  const assignedFace = {
    id: 'face-assigned',
    assetId: 'asset-1',
    box: { x: 0, y: 0, w: 100, h: 100 },
    embedding: [1, 0, 0, 0],
    personId: 'person-existing',
  }
  const unassignedFaceA = {
    id: 'face-a',
    assetId: 'asset-2',
    box: { x: 0, y: 0, w: 120, h: 120 },
    embedding: [0, 1, 0, 0],
    personId: null,
  }
  const unassignedFaceB = {
    id: 'face-b',
    assetId: 'asset-3',
    box: { x: 0, y: 0, w: 80, h: 80 },
    embedding: [0, 1, 0, 0],
    personId: null,
  }

  let http: {
    get: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
  }
  let service: FaceClusterService

  beforeEach(() => {
    http = {
      get: vi.fn().mockImplementation((url: string) => {
        if (url.includes('/v1/faces')) {
          return of({ data: { items: [assignedFace, unassignedFaceA, unassignedFaceB] }, status: 200 } as never)
        }
        if (url.includes('/v1/persons')) {
          return of({ data: { items: [] }, status: 200 } as never)
        }
        throw new Error(`Unexpected GET ${url}`)
      }),
      patch: vi.fn().mockReturnValue(of({ data: {}, status: 200 } as never)),
      post: vi.fn().mockReturnValue(of({ data: { id: 'person-new' }, status: 201 } as never)),
    }
    service = new FaceClusterService(http as unknown as HttpService, {} as BullMqService)
  })

  it('clusters only unassigned faces and never touches manually assigned ones', async () => {
    await service.cluster(userId)

    const patchUrls = http.patch.mock.calls.map(([url]) => String(url))
    const facePatches = patchUrls.filter((u) => u.includes('/v1/faces/'))
    expect(facePatches).toHaveLength(2)
    expect(facePatches.some((u) => u.endsWith('/face-a/person'))).toBe(true)
    expect(facePatches.some((u) => u.endsWith('/face-b/person'))).toBe(true)
    expect(patchUrls.some((u) => u.includes('/face-assigned/'))).toBe(false)

    expect(http.post).toHaveBeenCalledTimes(1)
    const createCall = http.post.mock.calls[0]!
    expect(String(createCall[0])).toContain('/v1/persons')
    const createBody = createCall[1] as { userId: string; clusterLabel: string }
    expect(createBody).toEqual({ userId, clusterLabel: 'cluster-0' })

    expect(patchUrls.some((u) => u.endsWith('/person-new/cover'))).toBe(true)
  })
})
