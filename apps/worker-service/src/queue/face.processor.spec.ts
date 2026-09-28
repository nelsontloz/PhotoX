import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { UnrecoverableError, type Job } from 'bullmq'
import { LocalStorageService } from '@photox/shared-config'
import { FACE_EMBEDDING_DIM } from '@photox/shared-types'
import { FaceProcessor } from './face.processor'
import { FaceDetectorService } from './face.detector'
import type { CoreClient } from '../core/core-client.service'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client'
import type { FaceJob } from './job-schemas'

function emb512(): number[] {
  const v = new Array<number>(FACE_EMBEDDING_DIM).fill(0)
  v[0] = 1
  return v
}

describe('FaceProcessor', () => {
  const detect = vi.fn()
  let storageDir: string
  let prevStorageDir: string | undefined
  let storage: LocalStorageService
  let fake: FakeCoreClient
  let callbacks: ((job: Job<FaceJob>) => Promise<void>)[]

  function setup() {
    callbacks = []
    const bullMq = {
      createWorker: vi.fn((_name: string, cb: (job: Job<FaceJob>) => Promise<void>) => {
        callbacks.push(cb)
        return {}
      }),
      getQueue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({}) })),
    }
    const processor = new FaceProcessor(bullMq as never, fake as unknown as CoreClient, storage, {
      detect,
    } as unknown as FaceDetectorService)
    processor.start()
    return callbacks[0]!
  }

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'photox-fp-test-'))
    prevStorageDir = process.env.STORAGE_DIR
    process.env.STORAGE_DIR = storageDir
    storage = new LocalStorageService()
    fake = new FakeCoreClient(storage)
    detect.mockReset()
  })

  afterEach(() => {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    rmSync(storageDir, { recursive: true, force: true })
  })

  async function seedPhoto() {
    const userId = randomUUID()
    const bytes = await sharp({
      create: { width: 200, height: 150, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
    const fileId = randomUUID()
    const storageKey = storage.buildKey('original', userId, fileId, 'jpg')
    await mkdir(dirname(storage.pathFor(storageKey)), { recursive: true })
    await writeFile(storage.pathFor(storageKey), bytes)
    fake.files.set(
      fileId,
      makeFileRecord({ id: fileId, userId, storageKey, mimeType: 'image/jpeg' }),
    )
    const asset = makeAsset({ id: randomUUID(), userId, fileId, kind: 'photo' })
    fake.assets.set(asset.id, asset)
    return { userId, fileId, asset }
  }

  it('rejects an invalid payload before any core call', async () => {
    const run = setup()
    await expect(
      run({
        data: { assetId: randomUUID(), fileId: 'not-a-uuid', userId: randomUUID() },
      } as Job<FaceJob>),
    ).rejects.toBeInstanceOf(UnrecoverableError)
    expect(fake.calls).toHaveLength(0)
  })

  it('rejects a job whose asset belongs to another user without mutating', async () => {
    const run = setup()
    const base = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() }
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: base.userId }))
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: randomUUID(), fileId: base.fileId }),
    )

    await expect(run({ data: base } as Job<FaceJob>)).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.callsOf('patchMetadata')).toHaveLength(0)
    expect(fake.deleteFacesCalls).toHaveLength(0)
  })

  it('unconditionally replaces faces after a successful detect and reports ready', async () => {
    const run = setup()
    const { userId, fileId, asset } = await seedPhoto()
    fake.faces.set(asset.id, [
      { box: { x: 0, y: 0, w: 5, h: 5 }, confidence: 0.9, embedding: emb512() },
    ])
    detect.mockResolvedValue([
      { box: { x: 10, y: 20, w: 30, h: 40 }, confidence: 0.92, embedding: emb512() },
    ])

    await run({ data: { assetId: asset.id, fileId, userId } } as Job<FaceJob>)

    expect(fake.calls.map((c) => c.method)).toEqual([
      'getFile',
      'getAsset',
      'patchMetadata',
      'deleteAssetFaces',
      'registerFaces',
      'patchMetadata',
    ])
    expect(fake.deleteFacesCalls).toEqual([asset.id])
    const faces = fake.faces.get(asset.id)!
    expect(faces).toHaveLength(1)
    expect(faces[0]!.box).toEqual({ x: 10, y: 20, w: 30, h: 40 })
    expect(faces[0]!.confidence).toBeCloseTo(0.92, 4)
    expect(faces[0]!.embedding).toHaveLength(FACE_EMBEDDING_DIM)

    const assetState = fake.assets.get(asset.id)!
    expect(assetState.faceStatus).toBe('ready')
    expect(assetState.faceCount).toBe(1)
  })

  it('clears faces and reports zero when nothing is detected', async () => {
    const run = setup()
    const { userId, fileId, asset } = await seedPhoto()
    detect.mockResolvedValue([])

    await run({ data: { assetId: asset.id, fileId, userId } } as Job<FaceJob>)

    expect(fake.deleteFacesCalls).toEqual([asset.id])
    expect(fake.callsOf('registerFaces')).toHaveLength(0)
    const assetState = fake.assets.get(asset.id)!
    expect(assetState.faceStatus).toBe('ready')
    expect(assetState.faceCount).toBe(0)
  })

  it('marks failed and swallows a missing-model error', async () => {
    const run = setup()
    const { userId, fileId, asset } = await seedPhoto()
    detect.mockRejectedValue(new Error('Face embedding model not found: /models/x.onnx'))

    await expect(
      run({ data: { assetId: asset.id, fileId, userId } } as Job<FaceJob>),
    ).resolves.toBeUndefined()

    expect(fake.callsOf('registerFaces')).toHaveLength(0)
    expect(fake.deleteFacesCalls).toHaveLength(0)
    expect(fake.assets.get(asset.id)!.faceStatus).toBe('failed')
  })
})
