import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FACE_EMBEDDING_DIM } from '@photox/data-access'
import { FaceClusterService } from './face.cluster'

interface FaceRow {
  id: string
  assetId: string
  box: { x: number; y: number; w: number; h: number }
  embedding: number[]
  confidence: number
  personId: string | null
}

const emb512 = (...pairs: [number, number][]): number[] => {
  const v = new Array<number>(FACE_EMBEDDING_DIM).fill(0)
  for (const [i, val] of pairs) v[i] = val
  return v
}

describe('FaceClusterService.cluster', () => {
  const userId = 'user-1'
  const face = (
    id: string,
    embedding: number[],
    personId: string | null = null,
    confidence = 0.9,
    size = 100,
  ): FaceRow => ({
    id,
    assetId: `asset-${id}`,
    box: { x: 0, y: 0, w: size, h: size },
    embedding,
    confidence,
    personId,
  })

  let faceRows: FaceRow[]
  let faceUpdates: { where: unknown; patch: unknown }[]
  let personUpdates: { where: unknown; patch: unknown }[]
  let created: { userId: string; clusterLabel: string }[]
  let andWhereMock: ReturnType<typeof vi.fn>
  let enqueueMock: ReturnType<typeof vi.fn>
  let service: FaceClusterService

  beforeEach(() => {
    faceRows = [
      { ...face('face-assigned', emb512([0, 1]), 'person-existing') },
      { ...face('face-a', emb512([1, 1]), null, 0.9, 120) },
      { ...face('face-b', emb512([1, 1])) },
    ]
    faceUpdates = []
    personUpdates = []
    created = []
    let personSeq = 0

    andWhereMock = vi.fn().mockReturnThis()
    enqueueMock = vi.fn().mockResolvedValue(undefined)
    const qb = {
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: andWhereMock,
      getMany: vi.fn().mockImplementation(() => Promise.resolve(faceRows)),
      getRawOne: vi.fn().mockResolvedValue({ count: '2' }),
    }
    const faceRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockImplementation((where: unknown, patch: unknown) => {
        faceUpdates.push({ where, patch })
        const row = faceRows.find((f) => f.id === (where as { id: string }).id)
        if (row) Object.assign(row, patch)
      }),
    }
    const personRepo = {
      create: vi.fn().mockImplementation((e: unknown) => ({ ...(e as object) })),
      save: vi.fn().mockImplementation((e: { userId: string; clusterLabel: string }) => {
        created.push(e)
        personSeq++
        const row = {
          id: `person-new-${personSeq}`,
          userId: e.userId,
          clusterLabel: e.clusterLabel,
        }
        return row
      }),
      update: vi.fn().mockImplementation((where: unknown, patch: unknown) => {
        personUpdates.push({ where, patch })
      }),
    }
    const bullMq = { enqueue: enqueueMock }
    const assetRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'asset-legacy', fileId: 'file-legacy', userId }]),
    }
    service = new FaceClusterService(
      faceRepo as never,
      personRepo as never,
      bullMq as never,
      assetRepo as never,
    )
  })

  it('clusters only unassigned faces and never touches manually assigned ones', async () => {
    await service.cluster(userId)

    expect(faceUpdates.some((u) => (u.where as { id: string }).id === 'face-assigned')).toBe(false)
    const targets = faceUpdates.map((u) => (u.patch as { personId: string }).personId)
    expect(targets).toHaveLength(2)
    expect(new Set(targets).size).toBe(1)
    expect(targets[0]).not.toBe('person-existing')

    expect(created).toHaveLength(1)
    expect(created[0]!.userId).toBe(userId)
    expect(created[0]!.clusterLabel).toMatch(
      /^cluster-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )

    expect(JSON.stringify(andWhereMock.mock.calls)).toContain('isTrashed')

    expect(
      personUpdates.some(
        (u) =>
          (u.where as { id: string }).id === targets[0] &&
          (u.patch as { coverFaceId: string }).coverFaceId === 'face-a',
      ),
    ).toBe(true)
  })

  it('does not merge different people across runs', async () => {
    faceRows = [face('face-a1', emb512([0, 1])), face('face-a2', emb512([0, 1]))]
    await service.cluster(userId)
    expect(created).toHaveLength(1)
    const firstPersonId = faceRows[0]!.personId
    expect(firstPersonId).not.toBeNull()

    faceRows.push(face('face-b1', emb512([1, 1])), face('face-b2', emb512([1, 1])))
    await service.cluster(userId)

    expect(created).toHaveLength(2)
    const bFaces = faceRows.filter((f) => f.id === 'face-b1' || f.id === 'face-b2')
    expect(bFaces[0]!.personId).not.toBeNull()
    expect(bFaces[0]!.personId).toBe(bFaces[1]!.personId)
    expect(bFaces[0]!.personId).not.toBe(firstPersonId)
  })

  it('keeps singleton noise faces unassigned beyond the tight noise threshold', async () => {
    // cosine distance 0.6 from the existing centroid: outside NOISE_ASSIGN_EPS 0.5 and DBSCAN 0.55
    faceRows = [
      face('face-known', emb512([0, 1]), 'person-existing'),
      face('face-noise', emb512([0, 0.4], [1, 0.9165])),
    ]
    await service.cluster(userId)

    expect(faceUpdates.some((u) => (u.where as { id: string }).id === 'face-noise')).toBe(false)
    expect(created).toHaveLength(0)
  })

  it('ignores low-confidence faces for clustering but leaves them stored', async () => {
    faceRows = [
      face('face-lo-a', emb512([1, 1]), null, 0.2),
      face('face-lo-b', emb512([1, 1]), null, 0.2),
    ]
    await service.cluster(userId)

    expect(created).toHaveLength(0)
    expect(faceUpdates).toHaveLength(0)
    expect(faceRows.every((f) => f.personId === null)).toBe(true)
  })

  it('skips legacy-dim rows and re-enqueues their assets for re-embed', async () => {
    faceRows = [
      { ...face('face-old-assigned', [1, 0, 0, 0], 'person-existing') },
      { ...face('face-old-a', [0, 1, 0, 0]), assetId: 'asset-legacy' },
      { ...face('face-old-b', [0, 1, 0, 0]), assetId: 'asset-legacy' },
    ]
    await service.cluster(userId)

    expect(faceUpdates).toHaveLength(0)
    expect(created).toHaveLength(0)
    expect(faceRows.every((f) => f.personId === null || f.id === 'face-old-assigned')).toBe(true)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(
      'process-faces',
      're-embed',
      { assetId: 'asset-legacy', fileId: 'file-legacy', userId, reason: 're-embed' },
      expect.objectContaining({ jobId: 'face-reembed-asset-legacy' }),
    )
  })
})
