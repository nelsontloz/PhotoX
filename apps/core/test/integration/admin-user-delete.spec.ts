import request from 'supertest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { dirname, join } from 'node:path'
import { backupPrefix } from '@photox/shared-config'
import { FACE_EMBEDDING_DIM, SEARCH_EMBEDDING_DIM } from '@photox/shared-types'
import {
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedThumbnail,
  seedUser,
  apiServer,
} from './helpers'
import type { ApiTestApp } from './helpers'
import { TEST_WORKER_SECRET } from './test-setup'

async function seedFullUser(t: ApiTestApp) {
  const user = await seedUser(t)
  // photo asset + thumbnail + face + embedding + ocr + detection
  const photoFile = await seedFile(t, user.id)
  const photo = await seedAsset(t, user.id, photoFile.id, { kind: 'photo' })
  await seedThumbnail(t, photo.id)
  await t.faceRepo.save(
    t.faceRepo.create({
      assetId: photo.id,
      userId: user.id,
      box: { x: 1, y: 2, w: 30, h: 40 },
      confidence: 0.9,
      embedding: new Array(FACE_EMBEDDING_DIM).fill(0.01),
      personId: null,
    }),
  )
  await t.embeddingRepo.save(
    t.embeddingRepo.create({
      assetId: photo.id,
      kind: 'image',
      model: 'siglip2-b16-224',
      embedding: new Array(SEARCH_EMBEDDING_DIM).fill(0.02),
    }),
  )
  await t.ocrRepo.save(t.ocrRepo.create({ assetId: photo.id, text: 'hello' }))
  await t.detectionRepo.save(
    t.detectionRepo.create({
      assetId: photo.id,
      label: 'cat',
      confidence: 0.8,
      box: { x: 0, y: 0, w: 10, h: 10 },
    }),
  )
  // trashed photo (deletion must include trashed rows, unlike hardDelete-by-request)
  const trashedFile = await seedFile(t, user.id)
  await seedAsset(t, user.id, trashedFile.id, { kind: 'photo', isTrashed: true })
  // video + transcode file
  const videoFile = await seedFile(t, user.id, { mimeType: 'video/mp4' })
  const transcodeFile = await seedFile(t, user.id, { mimeType: 'video/webm' })
  await seedAsset(t, user.id, videoFile.id, {
    kind: 'video',
    transcodeStatus: 'ready',
    transcodeFileId: transcodeFile.id,
  })
  await t.personRepo.save(
    t.personRepo.create({ userId: user.id, name: null, coverFaceId: null, clusterLabel: null }),
  )
  const album = await t.albumRepo.save(
    t.albumRepo.create({ userId: user.id, name: 'Trip', description: null }),
  )
  await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: photo.id }))
  await t.shareRepo.save(
    t.shareRepo.create({
      userId: user.id,
      kind: 'asset',
      assetId: photo.id,
      albumId: null,
      token: randomBytes(32).toString('hex'),
      expiresAt: null,
    }),
  )
  await t.refreshRepo.save(
    t.refreshRepo.create({
      userId: user.id,
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 3600_000),
      absoluteExpiresAt: null,
      revokedAt: null,
    }),
  )
  return { user, photoFile }
}

async function plantStray(t: ApiTestApp, key: string): Promise<string> {
  const full = t.storage.pathFor(key)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, Buffer.from(`stray-${randomUUID()}`))
  return full
}

/** Polls the delete-status endpoint until the run is terminal; returns the last state seen. */
async function waitForDeleteState(
  t: ApiTestApp,
  adminAuth: Record<string, string>,
  userId: string,
): Promise<string> {
  let state = ''
  for (let i = 0; i < 80; i++) {
    const status = await request(apiServer(t))
      .get(`/api/v1/admin/users/${userId}/delete-status`)
      .set(adminAuth)
    expect(status.status).toBe(200)
    state = (status.body as { state: string }).state
    if (state === 'completed' || state === 'failed') return state
    await new Promise((r) => setTimeout(r, 500))
  }
  return state
}

/**
 * Plays the worker's `user-delete` consumer: the queue consumer lives in the worker-service,
 * which is not booted here, so the harness reads the enqueued job and calls core's purge route
 * with that job's own identity + binding.
 */
async function runQueuedDelete(t: ApiTestApp, userId: string): Promise<void> {
  const job = await t.getQueue('user-delete').getJob(`user-delete-${userId}`)
  expect(job).not.toBeNull()
  const data = job!.data as { backupPrefix: string; sig: string }
  const res = await request(apiServer(t))
    .post(`/worker/users/${userId}/purge`)
    .set(
      t.authHeader(
        t.signWorkerToken({ id: userId, email: 'worker@internal', role: 'user' }, { act: true }),
      ),
    )
    .set('X-Job-Signature', data.sig)
    .send({ backupPrefix: data.backupPrefix })
  expect(res.status).toBe(200)
  // the real consumer was enqueued with removeOnComplete, so the record is gone afterwards
  // and the status poll falls back to core's progress
  await job!.remove()
}

describe('admin async user deletion', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
  })

  it('rejects guards: 404 missing, 403 self-delete, 403 non-admin, 403 worker act token', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const user = await seedUser(t)
    const adminAuth = t.authHeader(
      t.signToken({ id: admin.id, email: admin.email, role: admin.role }),
    )
    const userAuth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }))
    const actAuth = t.authHeader(
      t.signWorkerToken({ id: admin.id, email: admin.email, role: admin.role }, { act: true }),
    )

    const missing = await request(apiServer(t))
      .delete(`/api/v1/admin/users/${randomUUID()}`)
      .set(adminAuth)
    expect(missing.status).toBe(404)

    const selfDelete = await request(apiServer(t))
      .delete(`/api/v1/admin/users/${admin.id}`)
      .set(adminAuth)
    expect(selfDelete.status).toBe(403)

    const nonAdmin = await request(apiServer(t))
      .delete(`/api/v1/admin/users/${admin.id}`)
      .set(userAuth)
    expect(nonAdmin.status).toBe(403)

    // worker act tokens stay denied on the delete routes (not in the worker allowlist)
    const actDelete = await request(apiServer(t))
      .delete(`/api/v1/admin/users/${user.id}`)
      .set(actAuth)
    expect(actDelete.status).toBe(403)
    const actStatus = await request(apiServer(t))
      .get(`/api/v1/admin/users/${user.id}/delete-status`)
      .set(actAuth)
    expect(actStatus.status).toBe(403)

    // invalid UUID shape is a 400 via the params DTO, not a 500
    const badShape = await request(apiServer(t))
      .delete('/api/v1/admin/users/not-a-uuid')
      .set(adminAuth)
    expect(badShape.status).toBe(400)

    const statusMissing = await request(apiServer(t))
      .get(`/api/v1/admin/users/${randomUUID()}/delete-status`)
      .set(adminAuth)
    expect(statusMissing.status).toBe(404)
  })

  it('wipes the user end to end while keeping backups and other users intact', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const adminAuth = t.authHeader(
      t.signToken({ id: admin.id, email: admin.email, role: admin.role }),
    )
    const { user, photoFile } = await seedFullUser(t)
    const other = await seedUser(t)
    const otherFile = await seedFile(t, other.id)
    const otherAsset = await seedAsset(t, other.id, otherFile.id, { kind: 'photo' })

    // stray bytes with no FileRecord + a models sentinel that must survive
    const strayOriginal = await plantStray(t, `originals/${user.id}/stray.bin`)
    const strayThumb = await plantStray(t, `derivatives/thumbnails/${user.id}/stray.webp`)
    const strayTranscode = await plantStray(t, `derivatives/transcodes/${user.id}/stray.webm`)
    const modelSentinel = join(t.storageDir, 'models', 'keep.onnx')
    await mkdir(join(t.storageDir, 'models'), { recursive: true })
    await writeFile(modelSentinel, Buffer.from('model'))

    // a pending media job for the target is drained by the worker's consumer (covered by its
    // own spec); the API half only has to enqueue the wipe and report the prefix
    const del = await request(apiServer(t)).delete(`/api/v1/admin/users/${user.id}`).set(adminAuth)
    expect(del.status).toBe(202)
    const body = del.body as unknown as {
      jobId: string
      userId: string
      backupKept: boolean
      backupPrefix: string
    }
    expect(body).toEqual({
      jobId: `user-delete-${user.id}`,
      userId: user.id,
      backupKept: true,
      backupPrefix: backupPrefix(user.email, user.id),
    })

    // the worker consumes the job and asks core to run the wipe; then poll until terminal
    await runQueuedDelete(t, user.id)
    const state = await waitForDeleteState(t, adminAuth, user.id)
    expect(state).toBe('completed')

    // every owned row is gone, incl. trashed assets and CASCADE tables
    expect(await t.userRepo.findOne({ where: { id: user.id } })).toBeNull()
    expect(await t.refreshRepo.count({ where: { userId: user.id } })).toBe(0)
    expect(await t.shareRepo.count({ where: { userId: user.id } })).toBe(0)
    expect(await t.faceRepo.count({ where: { userId: user.id } })).toBe(0)
    expect(await t.personRepo.count({ where: { userId: user.id } })).toBe(0)
    expect(await t.albumRepo.count({ where: { userId: user.id } })).toBe(0)
    expect(await t.albumAssetRepo.count()).toBe(0)
    expect(await t.assetRepo.count({ where: { userId: user.id } })).toBe(0)
    expect(await t.fileRepo.count({ where: { userId: user.id } })).toBe(0)
    expect(await t.thumbRepo.count()).toBe(0)
    expect(await t.embeddingRepo.count()).toBe(0)
    expect(await t.ocrRepo.count()).toBe(0)
    expect(await t.detectionRepo.count()).toBe(0)

    // every owned byte is gone, strays swept, models untouched
    expect(await t.storage.exists(photoFile.storageKey)).toBe(false)
    expect(existsSync(strayOriginal)).toBe(false)
    expect(existsSync(strayThumb)).toBe(false)
    expect(existsSync(strayTranscode)).toBe(false)
    expect(existsSync(modelSentinel)).toBe(true)

    // other users are unaffected
    expect(await t.userRepo.findOne({ where: { id: other.id } })).not.toBeNull()
    expect(await t.assetRepo.findOne({ where: { id: otherAsset.id } })).not.toBeNull()
    expect(await t.fileRepo.findOne({ where: { id: otherFile.id } })).not.toBeNull()
    expect(await t.storage.exists(otherFile.storageKey)).toBe(true)
    expect(await t.userRepo.findOne({ where: { id: admin.id } })).not.toBeNull()
  }, 120_000)

  // Regression: BullMQ dedups by jobId, so a retained job for a userId used to silently
  // swallow every later delete of that id. The restore flow re-creates the account with its
  // original userId. The queue is consumed by the worker now, but the retained job still
  // carries a valid binding, so the wipe must still run for the restored account.
  it('re-deletes an account that came back with the same id despite a retained job record', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const adminAuth = t.authHeader(
      t.signToken({ id: admin.id, email: admin.email, role: admin.role }),
    )
    const user = await seedUser(t)
    const jobId = `user-delete-${user.id}`

    // pre-fix residue: a job retained under the deterministic jobId
    await t.getQueue('user-delete').add(
      'user-delete',
      {
        userId: user.id,
        email: user.email,
        backupPrefix: backupPrefix(user.email, user.id),
        // core stamps this at enqueue; the worker's consumer rejects an unsigned payload
        sig: createHmac('sha256', TEST_WORKER_SECRET).update(`${user.id}:${user.id}`).digest('hex'),
      },
      { jobId },
    )
    await runQueuedDelete(t, user.id)
    expect(await t.userRepo.findOne({ where: { id: user.id } })).toBeNull()

    // the account comes back with the same id (restore rebuilds rows from the manifest)
    await t.userRepo.save(
      t.userRepo.create({
        id: user.id,
        email: user.email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Restored User',
      }),
    )

    const del = await request(apiServer(t)).delete(`/api/v1/admin/users/${user.id}`).set(adminAuth)
    expect(del.status).toBe(202)

    // the retained job still supplies the wipe for the restored account
    await runQueuedDelete(t, user.id)
    expect(await t.userRepo.findOne({ where: { id: user.id } })).toBeNull()
  }, 120_000)
})
