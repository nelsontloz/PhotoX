import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { FACE_EMBEDDING_DIM } from '@photox/shared-types'
import { makeAsset, makeFileRecord } from '../fake-core-client'
import type { ClusterFace } from '../../src/core/core-client.service'
import { BullMqService } from '../../src/queue/bullmq.service'
import { CLUSTER_DEBOUNCE_MS } from '../../src/queue/face.processor'
import { createTestApp, closeTestApp, resetTestApp, waitForJob, type TestApp } from './helpers'

const emb512 = (...pairs: [number, number][]): number[] => {
  const v = new Array<number>(FACE_EMBEDDING_DIM).fill(0)
  for (const [i, val] of pairs) v[i] = val
  return v
}

describe('Face pipeline (integration)', () => {
  let testApp: TestApp
  const detect = vi.fn()

  beforeAll(async () => {
    testApp = await createTestApp({ detect })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
  })

  beforeEach(async () => {
    await resetTestApp(testApp)
    detect.mockReset()

    const queue = testApp.getQueue('process-faces-cluster')
    for (const job of await queue.getDelayed()) await job.remove()
  })

  // face-processor cases run entirely through the fake CoreClient (no DB rows)
  async function seedPhotoInFake(userId: string) {
    const bytes = await sharp({
      create: { width: 200, height: 150, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
    const fileId = randomUUID()
    const storageKey = testApp.storage.buildKey('original', userId, fileId, 'jpg')
    await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(testApp.storage.pathFor(storageKey), bytes)
    const record = makeFileRecord({
      id: fileId,
      userId,
      storageKey,
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    })
    testApp.fake.files.set(record.id, record)
    const asset = makeAsset({ id: randomUUID(), userId, fileId: record.id, kind: 'photo' })
    testApp.fake.assets.set(asset.id, asset)
    return { record, asset }
  }

  // cluster cases seed the E1 face list directly — core owns trashed filtering + persistence
  function seedClusterFace(
    assetId: string,
    embedding: number[],
    opts: {
      box?: { x: number; y: number; w: number; h: number }
      personId?: string | null
      confidence?: number
      id?: string
    } = {},
  ): ClusterFace {
    const face: ClusterFace = {
      id: opts.id ?? randomUUID(),
      assetId,
      box: opts.box ?? { x: 0, y: 0, w: 100, h: 100 },
      confidence: opts.confidence ?? 0.9,
      personId: opts.personId ?? null,
      embedding,
    }
    testApp.fake.clusterFaces.push(face)
    return face
  }

  async function runClusterJob(userId: string) {
    const queue = testApp.getQueue('process-faces-cluster')
    const job = await queue.add('cluster', { userId })
    expect(await waitForJob(queue, job.id!)).toBe('completed')
  }

  async function runFaceJob(
    assetId: string,
    fileId: string,
    userId: string,
    reason?: 'initial' | 're-embed',
  ) {
    const queue = testApp.getQueue('process-faces')
    const job = await queue.add('face', { assetId, fileId, userId, reason })
    return { queue, job }
  }

  it('saves a detected face and auto-enqueues clustering for the asset', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedPhotoInFake(userId)
    detect.mockResolvedValue([
      { box: { x: 10, y: 20, w: 30, h: 40 }, confidence: 0.92, embedding: emb512([1, 1]) },
    ])

    const clusterAdd = vi.spyOn(testApp.getQueue('process-faces-cluster'), 'add')

    const { queue, job } = await runFaceJob(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const faces = testApp.fake.faces.get(asset.id)!
    expect(faces).toHaveLength(1)
    expect(faces[0]!.embedding).toHaveLength(FACE_EMBEDDING_DIM)
    expect(faces[0]!.confidence).toBeCloseTo(0.92, 4)
    expect(faces[0]!.box).toEqual({ x: 10, y: 20, w: 30, h: 40 })

    const updated = testApp.fake.assets.get(asset.id)!
    expect(updated.faceStatus).toBe('ready')
    expect(updated.faceCount).toBe(1)

    expect(clusterAdd).toHaveBeenCalledExactlyOnceWith(
      'cluster',
      { userId, reason: 'face-detected' },
      {
        jobId: `cluster-${userId}`,
        delay: CLUSTER_DEBOUNCE_MS,
        attempts: 3,
        backoff: { type: 'exponential' },
        removeOnComplete: true,
        removeOnFail: true,
      },
    )

    clusterAdd.mockRestore()
  })

  it('unconditionally replaces existing faces after a successful detect', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedPhotoInFake(userId)
    testApp.fake.faces.set(asset.id, [
      { box: { x: 1, y: 1, w: 10, h: 10 }, confidence: 0.8, embedding: emb512([1, 1]) },
    ])

    detect.mockResolvedValue([
      { box: { x: 5, y: 5, w: 50, h: 50 }, confidence: 0.8, embedding: emb512([0, 1]) },
    ])

    const { queue, job } = await runFaceJob(asset.id, record.id, userId, 're-embed')
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    expect(testApp.fake.deleteFacesCalls).toEqual([asset.id])
    const faces = testApp.fake.faces.get(asset.id)!
    expect(faces).toHaveLength(1)
    expect(faces[0]!.box).toEqual({ x: 5, y: 5, w: 50, h: 50 })
    expect(faces[0]!.embedding).toEqual(emb512([0, 1]))

    const updated = testApp.fake.assets.get(asset.id)!
    expect(updated.faceStatus).toBe('ready')
    expect(updated.faceCount).toBe(1)
  })

  it('marks faceStatus ready with zero faces when nothing is detected', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedPhotoInFake(userId)
    detect.mockResolvedValue([])

    const clusterAdd = vi.spyOn(testApp.getQueue('process-faces-cluster'), 'add')

    const { queue, job } = await runFaceJob(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    expect(clusterAdd).not.toHaveBeenCalled()

    expect(testApp.fake.faces.get(asset.id)).toBeUndefined()
    const updated = testApp.fake.assets.get(asset.id)!
    expect(updated.faceStatus).toBe('ready')
    expect(updated.faceCount).toBe(0)

    clusterAdd.mockRestore()
  })

  it('debounces cluster enqueues per user into a single delayed job', async () => {
    const userId = randomUUID()
    const first = await seedPhotoInFake(userId)
    const second = await seedPhotoInFake(userId)
    detect.mockResolvedValue([
      { box: { x: 10, y: 20, w: 30, h: 40 }, confidence: 0.92, embedding: emb512([1, 1]) },
    ])

    for (const { record, asset } of [first, second]) {
      const { queue, job } = await runFaceJob(asset.id, record.id, userId)
      expect(await waitForJob(queue, job.id!)).toBe('completed')
    }

    const clusterQueue = testApp.getQueue('process-faces-cluster')
    expect(await clusterQueue.getWaitingCount()).toBe(0)
    const delayed = await clusterQueue.getDelayed()
    expect(delayed).toHaveLength(1)
    expect(delayed[0]!.id).toBe(`cluster-${userId}`)
    expect(delayed[0]!.opts.delay).toBe(CLUSTER_DEBOUNCE_MS)
  })

  it('creates one person from close unassigned faces and uses the largest box as cover', async () => {
    const userId = randomUUID()
    const faceA = seedClusterFace(randomUUID(), emb512([1, 1]), {
      box: { x: 0, y: 0, w: 120, h: 120 },
    })
    const faceB = seedClusterFace(randomUUID(), emb512([1, 1]))

    await runClusterJob(userId)

    expect(testApp.fake.callsOf('getFacesForCluster').map((c) => c.args[0])).toEqual([userId])
    expect(testApp.fake.applyClustersCalls).toHaveLength(1)
    const plan = testApp.fake.applyClustersCalls[0]!
    expect(plan.attaches).toEqual([])
    expect(plan).toHaveProperty('creates')
    expect(plan).toHaveProperty('attaches')
    expect(plan.creates).toHaveLength(1)
    const create = plan.creates[0]!
    expect(create.clusterLabel).toMatch(/^cluster-[0-9a-f-]{36}$/)
    expect(new Set(create.faceIds)).toEqual(new Set([faceA.id, faceB.id]))
    expect(create.coverFaceId).toBe(faceA.id)
  })

  it('skips clustering entirely when core returns no faces (trashed filtered upstream)', async () => {
    // core's E1 excludeTrashed coverage lives in jwt-persons.spec.ts; the worker just sees []
    const userId = randomUUID()

    await runClusterJob(userId)

    expect(testApp.fake.callsOf('getFacesForCluster')).toHaveLength(1)
    expect(testApp.fake.callsOf('applyClusters')).toHaveLength(0)
  })

  it('leaves manually assigned faces untouched and only plans unassigned ones', async () => {
    const userId = randomUUID()
    const personId = randomUUID()
    const assignedA = seedClusterFace(randomUUID(), emb512([0, 1]), { personId })
    const assignedB = seedClusterFace(randomUUID(), emb512([0, 1]), { personId })
    const freeA = seedClusterFace(randomUUID(), emb512([1, 1]))
    const freeB = seedClusterFace(randomUUID(), emb512([1, 1]))

    await runClusterJob(userId)

    const plan = testApp.fake.applyClustersCalls[0]!
    const planned = [...plan.creates, ...plan.attaches].flatMap((i) => i.faceIds)
    expect(planned).not.toContain(assignedA.id)
    expect(planned).not.toContain(assignedB.id)
    expect(plan.creates).toHaveLength(1)
    expect(new Set(plan.creates[0]!.faceIds)).toEqual(new Set([freeA.id, freeB.id]))
    expect(plan.attaches).toEqual([])
  })

  it('attaches a noise singleton to an existing person without sending a null cover', async () => {
    const userId = randomUUID()
    const personId = randomUUID()
    seedClusterFace(randomUUID(), emb512([0, 1]), { personId })
    const noise = seedClusterFace(randomUUID(), emb512([0, 1]))

    await runClusterJob(userId)

    const plan = testApp.fake.applyClustersCalls[0]!
    expect(plan.creates).toEqual([])
    expect(plan.attaches).toHaveLength(1)
    expect(plan.attaches[0]!.personId).toBe(personId)
    expect(plan.attaches[0]!.faceIds).toEqual([noise.id])
    expect('coverFaceId' in plan.attaches[0]!).toBe(false)
  })

  it('skips the apply call when there is nothing to apply (low-confidence only)', async () => {
    const userId = randomUUID()
    seedClusterFace(randomUUID(), emb512([1, 1]), { confidence: 0.2 })
    seedClusterFace(randomUUID(), emb512([1, 1]), { confidence: 0.2 })

    await runClusterJob(userId)

    expect(testApp.fake.callsOf('getFacesForCluster')).toHaveLength(1)
    expect(testApp.fake.callsOf('applyClusters')).toHaveLength(0)
  })

  it('re-enqueues legacy-dim unassigned assets for re-embed and skips apply', async () => {
    const userId = randomUUID()
    const assetId = randomUUID()
    const fileId = randomUUID()
    testApp.fake.assets.set(assetId, makeAsset({ id: assetId, userId, fileId }))
    seedClusterFace(assetId, [1, 0, 0, 0])
    seedClusterFace(assetId, [0, 1, 0, 0])

    const enqueueSpy = vi.spyOn(testApp.app.get(BullMqService), 'enqueue')

    await runClusterJob(userId)

    expect(testApp.fake.callsOf('getAssetsByIds').map((c) => c.args[1])).toEqual([[assetId]])
    expect(enqueueSpy).toHaveBeenCalledWith(
      'process-faces',
      're-embed',
      { assetId, fileId, userId, reason: 're-embed' },
      expect.objectContaining({
        jobId: `face-reembed-${assetId}`,
        attempts: 3,
        backoff: { type: 'exponential' },
        removeOnFail: true,
      }),
    )
    expect(testApp.fake.callsOf('applyClusters')).toHaveLength(0)

    enqueueSpy.mockRestore()
  })
})
