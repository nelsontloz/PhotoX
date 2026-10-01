import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FACE_EMBEDDING_DIM } from '@photox/shared-types'
import { FaceClusterService } from './face.cluster'
import type { ApplyClustersPayload, ClusterFace } from '../core/core-client.service'

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
  ): ClusterFace => ({
    id,
    assetId: `asset-${id}`,
    box: { x: 0, y: 0, w: size, h: size },
    embedding,
    confidence,
    personId,
  })

  let faces: ClusterFace[]
  let plans: ApplyClustersPayload[]
  let enqueueMock: ReturnType<typeof vi.fn>
  let getAssetsByIdsMock: ReturnType<typeof vi.fn>
  let service: FaceClusterService

  beforeEach(() => {
    faces = [
      face('face-assigned', emb512([0, 1]), 'person-existing'),
      face('face-a', emb512([1, 1]), null, 0.9, 120),
      face('face-b', emb512([1, 1])),
    ]
    plans = []
    let personSeq = 0

    enqueueMock = vi.fn().mockResolvedValue(undefined)
    getAssetsByIdsMock = vi.fn().mockResolvedValue([{ id: 'asset-legacy', fileId: 'file-legacy' }])
    const core = {
      getFacesForCluster: vi.fn().mockImplementation(() =>
        Promise.resolve(
          faces.map((f) => ({
            ...f,
            box: { ...f.box },
            embedding: [...f.embedding],
          })),
        ),
      ),
      getAssetsByIds: getAssetsByIdsMock,
      // mirror core's writes so a second run observes the applied plan
      applyClusters: vi.fn().mockImplementation((_uid: string, payload: ApplyClustersPayload) => {
        plans.push(payload)
        const assign = (faceId: string, personId: string) => {
          const row = faces.find((f) => f.id === faceId)
          if (row) row.personId = personId
        }
        for (const create of payload.creates) {
          personSeq++
          for (const faceId of create.faceIds) assign(faceId, `person-new-${personSeq}`)
        }
        for (const attach of payload.attaches) {
          for (const faceId of attach.faceIds) assign(faceId, attach.personId)
        }
        const faceIds = [...payload.creates, ...payload.attaches].flatMap((i) => i.faceIds)
        return Promise.resolve({ created: payload.creates.length, assigned: new Set(faceIds).size })
      }),
    }
    service = new FaceClusterService({ enqueue: enqueueMock } as never, core as never)
  })

  it('clusters only unassigned faces and never touches manually assigned ones', async () => {
    await service.cluster(userId)

    expect(plans).toHaveLength(1)
    const plan = plans[0]!
    expect(plan.attaches).toEqual([])
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0]!.faceIds).toEqual(['face-a', 'face-b'])
    expect(plan.creates[0]!.coverFaceId).toBe('face-a')
    expect(plan.creates[0]!.clusterLabel).toMatch(
      /^cluster-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(faces.find((f) => f.id === 'face-assigned')!.personId).toBe('person-existing')
  })

  it('attaches a cluster to the nearest existing person with the largest-box cover', async () => {
    faces = [
      face('face-known-a', emb512([1, 1]), 'person-existing', 0.9, 50),
      face('face-known-b', emb512([1, 1]), 'person-existing', 0.9, 50),
      face('face-a', emb512([1, 1]), null, 0.9, 120),
      face('face-b', emb512([1, 1])),
    ]

    await service.cluster(userId)

    const plan = plans[0]!
    expect(plan.creates).toEqual([])
    expect(plan.attaches).toEqual([
      { personId: 'person-existing', faceIds: ['face-a', 'face-b'], coverFaceId: 'face-a' },
    ])
  })

  it('merges a later cluster into an earlier pending create instead of attaching by fake id', async () => {
    // adjacent vectors chain (-10°→10° ≈ 0.06, 10°→45° ≈ 0.18, 45°→65° ≈ 0.06, each ≤ eps), so all
    // four faces land in one DBSCAN cluster and a single create — no cross distances above eps
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)])
    }
    faces = [
      face('face-a1', dir(-10), null, 0.9, 100),
      face('face-a2', dir(10), null, 0.9, 100),
      face('face-b1', dir(45), null, 0.9, 120),
      face('face-b2', dir(65), null, 0.9, 90),
    ]

    await service.cluster(userId)

    expect(plans).toHaveLength(1)
    const plan = plans[0]!
    expect(plan.attaches).toEqual([])
    expect(plan.creates).toHaveLength(1)
    expect(new Set(plan.creates[0]!.faceIds)).toEqual(
      new Set(['face-a1', 'face-a2', 'face-b1', 'face-b2']),
    )
    expect(plan.creates[0]!.coverFaceId).toBe('face-b1')
  })

  it('blocks attach when two existing persons are near-tied for the candidate', async () => {
    // candidate sits at 12.5°, equidistant (~0.024) from person-1 at 0° and person-2 at 25°:
    // runner-up margin ~0 < CLUSTER_MATCH_MARGIN, so the cluster stays a create (over-split)
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)])
    }
    faces = [
      face('face-p1', dir(0), 'person-1'),
      face('face-p2', dir(25), 'person-2'),
      face('face-c1', dir(12.5), null, 0.9, 120),
      face('face-c2', dir(12.5)),
    ]

    await service.cluster(userId)

    expect(plans).toHaveLength(1)
    const plan = plans[0]!
    expect(plan.attaches).toEqual([])
    expect(plan.creates).toHaveLength(1)
    expect(new Set(plan.creates[0]!.faceIds)).toEqual(new Set(['face-c1', 'face-c2']))
  })

  it('attaches when the nearest person clearly beats the runner-up', async () => {
    // candidate at 5°: person-1 at 0° is ~0.004 away, person-2 at 60° is ~0.43 away — clear winner
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)])
    }
    faces = [
      face('face-p1', dir(0), 'person-1'),
      face('face-p2', dir(60), 'person-2'),
      face('face-c1', dir(5), null, 0.9, 120),
      face('face-c2', dir(5)),
    ]

    await service.cluster(userId)

    expect(plans).toHaveLength(1)
    const plan = plans[0]!
    expect(plan.creates).toEqual([])
    expect(plan.attaches).toEqual([
      { personId: 'person-1', faceIds: ['face-c1', 'face-c2'], coverFaceId: 'face-c1' },
    ])
  })

  it('reassigns a lone noise face just inside the noise threshold', async () => {
    // cosine distance 1 - cos(41°) ≈ 0.245: inside NOISE_ASSIGN_EPS 0.30, sole person so no runner-up
    const dir = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return emb512([0, Math.cos(rad)], [1, Math.sin(rad)])
    }
    faces = [face('face-known', dir(0), 'person-existing'), face('face-noise', dir(41))]

    await service.cluster(userId)

    expect(plans).toHaveLength(1)
    const plan = plans[0]!
    expect(plan.creates).toEqual([])
    expect(plan.attaches).toEqual([{ personId: 'person-existing', faceIds: ['face-noise'] }])
  })

  it('does not merge different people across runs', async () => {
    faces = [face('face-a1', emb512([0, 1])), face('face-a2', emb512([0, 1]))]
    await service.cluster(userId)
    expect(plans).toHaveLength(1)
    const firstPersonId = faces[0]!.personId
    expect(firstPersonId).not.toBeNull()

    faces.push(face('face-b1', emb512([1, 1])), face('face-b2', emb512([1, 1])))
    await service.cluster(userId)

    expect(plans).toHaveLength(2)
    expect(plans[1]!.creates).toHaveLength(1)
    expect(plans[1]!.attaches).toEqual([])
    const bFaces = faces.filter((f) => f.id === 'face-b1' || f.id === 'face-b2')
    expect(bFaces[0]!.personId).not.toBeNull()
    expect(bFaces[0]!.personId).toBe(bFaces[1]!.personId)
    expect(bFaces[0]!.personId).not.toBe(firstPersonId)
  })

  it('keeps singleton noise faces unassigned beyond the tight noise threshold', async () => {
    // cosine distance 0.6 from the existing centroid: outside NOISE_ASSIGN_EPS 0.30 and DBSCAN 0.35
    faces = [
      face('face-known', emb512([0, 1]), 'person-existing'),
      face('face-noise', emb512([0, 0.4], [1, 0.9165])),
    ]
    await service.cluster(userId)

    expect(plans).toHaveLength(0)
    expect(faces.find((f) => f.id === 'face-noise')!.personId).toBeNull()
  })

  it('ignores low-confidence faces for clustering but leaves them stored', async () => {
    faces = [
      face('face-lo-a', emb512([1, 1]), null, 0.2),
      face('face-lo-b', emb512([1, 1]), null, 0.2),
    ]
    await service.cluster(userId)

    expect(plans).toHaveLength(0)
    expect(faces.every((f) => f.personId === null)).toBe(true)
  })

  it('skips legacy-dim rows and re-enqueues their assets for re-embed', async () => {
    faces = [
      { ...face('face-old-assigned', [1, 0, 0, 0], 'person-existing') },
      { ...face('face-old-a', [0, 1, 0, 0]), assetId: 'asset-legacy' },
      { ...face('face-old-b', [0, 1, 0, 0]), assetId: 'asset-legacy' },
    ]
    await service.cluster(userId)

    expect(plans).toHaveLength(0)
    expect(faces.every((f) => f.personId === null || f.id === 'face-old-assigned')).toBe(true)
    expect(getAssetsByIdsMock).toHaveBeenCalledWith(userId, ['asset-legacy'])
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(
      'process-faces',
      're-embed',
      { assetId: 'asset-legacy', fileId: 'file-legacy', userId, reason: 're-embed' },
      expect.objectContaining({ jobId: 'face-reembed-asset-legacy' }),
    )
  })
})
