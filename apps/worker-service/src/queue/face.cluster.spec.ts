import { describe, it, expect, vi, beforeEach } from 'vitest'
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

  let faceRows: (typeof assignedFace)[] & { personId: string | null }[]
  let personRows: { id: string; userId: string; clusterLabel: string | null }[]
  let faceUpdates: { where: unknown; patch: unknown }[]
  let personUpdates: { where: unknown; patch: unknown }[]
  let created: { userId: string; clusterLabel: string }[]
  let service: FaceClusterService

  beforeEach(() => {
    faceRows = [
      { ...assignedFace },
      { ...unassignedFaceA },
      { ...unassignedFaceB },
    ] as typeof faceRows
    personRows = [{ id: 'person-existing', userId, clusterLabel: 'cluster-9' }]
    faceUpdates = []
    personUpdates = []
    created = []

    const faceRepo = {
      find: vi.fn().mockResolvedValue(faceRows),
      update: vi.fn().mockImplementation((where: unknown, patch: unknown) => {
        faceUpdates.push({ where, patch })
        const row = faceRows.find((f) => f.id === (where as { id: string }).id)
        if (row) Object.assign(row, patch)
      }),
      createQueryBuilder: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ count: '2' }),
      }),
    }
    const personRepo = {
      find: vi.fn().mockResolvedValue(personRows),
      create: vi.fn().mockImplementation((e: unknown) => ({ ...(e as object) })),
      save: vi.fn().mockImplementation((e: { userId: string; clusterLabel: string }) => {
        created.push(e)
        const row = { id: 'person-new', userId: e.userId, clusterLabel: e.clusterLabel }
        personRows.push(row)
        return row
      }),
      update: vi.fn().mockImplementation((where: unknown, patch: unknown) => {
        personUpdates.push({ where, patch })
      }),
    }
    service = new FaceClusterService(faceRepo as never, personRepo as never, {} as BullMqService)
  })

  it('clusters only unassigned faces and never touches manually assigned ones', async () => {
    await service.cluster(userId)

    const assignedUpdates = faceUpdates.filter(
      (u) => (u.patch as { personId: string }).personId === 'person-new',
    )
    expect(assignedUpdates).toHaveLength(2)
    expect(assignedUpdates.some((u) => (u.where as { id: string }).id === 'face-a')).toBe(true)
    expect(assignedUpdates.some((u) => (u.where as { id: string }).id === 'face-b')).toBe(true)
    expect(faceUpdates.some((u) => (u.where as { id: string }).id === 'face-assigned')).toBe(false)

    expect(created).toHaveLength(1)
    expect(created[0]).toEqual({ userId, clusterLabel: 'cluster-0', name: null, faceCount: 0 })

    expect(
      personUpdates.some(
        (u) =>
          (u.where as { id: string }).id === 'person-new' &&
          (u.patch as { coverFaceId: string }).coverFaceId === 'face-a',
      ),
    ).toBe(true)
  })
})
