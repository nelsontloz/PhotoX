import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { FACE_EMBEDDING_DIM } from '@photox/data-access'
import { createTestApp, closeTestApp, resetDb, waitForJob, type TestApp } from './helpers'

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
    await resetDb(testApp)
    detect.mockReset()
  })

  async function seedPhoto(userId: string) {
    const bytes = await sharp({
      create: { width: 200, height: 150, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
    const storageKey = testApp.storage.buildKey('original', userId, randomUUID(), 'jpg')
    await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(testApp.storage.pathFor(storageKey), bytes)
    const record = await testApp.fileRepo.save(
      testApp.fileRepo.create({
        userId,
        storageKey,
        originalName: 'face.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        purpose: 'original',
        assetId: null,
      }),
    )
    const asset = await testApp.assetRepo.save(
      testApp.assetRepo.create({ userId, kind: 'photo', fileId: record.id }),
    )
    return { record, asset }
  }

  function seedAsset(userId: string, isTrashed = false) {
    return testApp.assetRepo.save(
      testApp.assetRepo.create({ userId, kind: 'photo', fileId: randomUUID(), isTrashed }),
    )
  }

  function seedFace(
    userId: string,
    assetId: string,
    embedding: number[],
    box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 100, h: 100 },
    personId: string | null = null,
    confidence = 0.9,
  ) {
    return testApp.faceRepo.save(
      testApp.faceRepo.create({ assetId, userId, box, confidence, embedding, personId }),
    )
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
    const { record, asset } = await seedPhoto(userId)
    detect.mockResolvedValue([
      { box: { x: 10, y: 20, w: 30, h: 40 }, confidence: 0.92, embedding: emb512([1, 1]) },
    ])

    const clusterAdd = vi.spyOn(testApp.getQueue('process-faces-cluster'), 'add')

    const { queue, job } = await runFaceJob(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const faces = await testApp.faceRepo.find({ where: { assetId: asset.id } })
    expect(faces).toHaveLength(1)
    expect(faces[0]!.embedding).toHaveLength(FACE_EMBEDDING_DIM)
    expect(faces[0]!.personId).toBeNull()
    expect(faces[0]!.confidence).toBeCloseTo(0.92, 4)
    expect(faces[0]!.box).toEqual({ x: 10, y: 20, w: 30, h: 40 })

    const updated = await testApp.assetRepo.findOne({ where: { id: asset.id } })
    expect(updated!.faceStatus).toBe('ready')
    expect(updated!.faceCount).toBe(1)

    const jobOptions = clusterAdd.mock.calls.map((call) => call[2] as { jobId?: string })
    expect(jobOptions.some((o) => o.jobId?.startsWith(`cluster-${userId}-${asset.id}-`))).toBe(true)

    clusterAdd.mockRestore()
  })

  it('re-embed clears existing faces and recomputes dangling person state', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedPhoto(userId)
    const person = await testApp.personRepo.save(
      testApp.personRepo.create({ userId, name: null, clusterLabel: 'cluster-old', faceCount: 1 }),
    )
    const oldFace = await seedFace(userId, asset.id, emb512([1, 1]), undefined, person.id)
    await testApp.personRepo.update(person.id, { coverFaceId: oldFace.id })

    detect.mockResolvedValue([
      { box: { x: 5, y: 5, w: 50, h: 50 }, confidence: 0.8, embedding: emb512([0, 1]) },
    ])

    const { queue, job } = await runFaceJob(asset.id, record.id, userId, 're-embed')
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const faces = await testApp.faceRepo.find({ where: { assetId: asset.id } })
    expect(faces).toHaveLength(1)
    expect(faces[0]!.id).not.toBe(oldFace.id)
    expect(faces[0]!.personId).toBeNull()

    const refreshed = await testApp.personRepo.findOne({ where: { id: person.id } })
    expect(refreshed!.coverFaceId).toBeNull()
    expect(refreshed!.faceCount).toBe(0)
  })

  it('marks faceStatus ready with zero faces when nothing is detected', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedPhoto(userId)
    detect.mockResolvedValue([])

    const { queue, job } = await runFaceJob(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    expect(await testApp.faceRepo.count({ where: { assetId: asset.id } })).toBe(0)
    const updated = await testApp.assetRepo.findOne({ where: { id: asset.id } })
    expect(updated!.faceStatus).toBe('ready')
    expect(updated!.faceCount).toBe(0)
  })

  it('creates one person from close unassigned faces and uses the largest box as cover', async () => {
    const userId = randomUUID()
    const assetA = await seedAsset(userId)
    const assetB = await seedAsset(userId)
    const faceA = await seedFace(userId, assetA.id, emb512([1, 1]), { x: 0, y: 0, w: 120, h: 120 })
    await seedFace(userId, assetB.id, emb512([1, 1]), { x: 0, y: 0, w: 100, h: 100 })

    const queue = testApp.getQueue('process-faces-cluster')
    const job = await queue.add('cluster', { userId })
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const faces = await testApp.faceRepo.find({ where: { userId } })
    expect(faces).toHaveLength(2)
    expect(faces.every((f) => f.personId !== null)).toBe(true)
    expect(new Set(faces.map((f) => f.personId)).size).toBe(1)

    const persons = await testApp.personRepo.find({ where: { userId } })
    expect(persons).toHaveLength(1)
    expect(persons[0]!.faceCount).toBe(2)
    expect(persons[0]!.coverFaceId).toBe(faceA.id)
  })

  it('ignores faces of trashed assets when clustering', async () => {
    const userId = randomUUID()
    const asset = await seedAsset(userId, true)
    await seedFace(userId, asset.id, emb512([1, 1]))
    await seedFace(userId, asset.id, emb512([1, 1]))

    const queue = testApp.getQueue('process-faces-cluster')
    const job = await queue.add('cluster', { userId })
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const faces = await testApp.faceRepo.find({ where: { userId } })
    expect(faces).toHaveLength(2)
    expect(faces.every((f) => f.personId === null)).toBe(true)
    expect(await testApp.personRepo.count({ where: { userId } })).toBe(0)
  })

  it('leaves manually assigned faces untouched', async () => {
    const userId = randomUUID()
    const assetA = await seedAsset(userId)
    const assetB = await seedAsset(userId)
    const assetC = await seedAsset(userId)
    const assetD = await seedAsset(userId)
    const person = await testApp.personRepo.save(
      testApp.personRepo.create({ userId, name: 'Alice', clusterLabel: null, faceCount: 2 }),
    )
    const assignedA = await seedFace(
      userId,
      assetA.id,
      emb512([0, 1]),
      { x: 0, y: 0, w: 90, h: 90 },
      person.id,
    )
    const assignedB = await seedFace(
      userId,
      assetB.id,
      emb512([0, 1]),
      { x: 0, y: 0, w: 80, h: 80 },
      person.id,
    )
    await testApp.personRepo.update(person.id, { coverFaceId: assignedA.id })
    const freeA = await seedFace(userId, assetC.id, emb512([1, 1]))
    const freeB = await seedFace(userId, assetD.id, emb512([1, 1]))

    const queue = testApp.getQueue('process-faces-cluster')
    const job = await queue.add('cluster', { userId })
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const byId = new Map((await testApp.faceRepo.find({ where: { userId } })).map((f) => [f.id, f]))
    expect(byId.get(assignedA.id)!.personId).toBe(person.id)
    expect(byId.get(assignedB.id)!.personId).toBe(person.id)
    const newPersonId = byId.get(freeA.id)!.personId
    expect(newPersonId).toBeTruthy()
    expect(newPersonId).not.toBe(person.id)
    expect(byId.get(freeB.id)!.personId).toBe(newPersonId)

    const persons = await testApp.personRepo.find({ where: { userId } })
    expect(persons).toHaveLength(2)
    const original = persons.find((p) => p.id === person.id)!
    expect(original.faceCount).toBe(2)
    expect(original.coverFaceId).toBe(assignedA.id)
    expect(persons.find((p) => p.id === newPersonId)!.faceCount).toBe(2)
  })
})
