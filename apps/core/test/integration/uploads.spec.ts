import request from 'supertest'
import { createHash, randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { closeTestApp, createApiTestApp, resetDb, seedUser, apiServer } from './helpers'
import type { ApiTestApp } from './helpers'
import {
  UPLOAD_CHUNK_SIZE_BYTES,
  UPLOAD_MAX_ACTIVE_SESSIONS,
} from '../../src/uploads/uploads.service'
import { UploadSessionsSweeper } from '../../src/uploads/upload-sessions.sweeper'
import type { User } from '../../src/users/entities/user.entity'

// 16 MiB: the out-of-order happy path needs two real 8 MiB parts, and the authoritative-quota
// test needs room to prefill over the ceiling without uploading anything big. Set BEFORE
// createApiTestApp (init-time loadEnv reads) — the service reads it per request too.
const STORAGE_QUOTA_BYTES = 16 * 1024 * 1024
process.env.STORAGE_QUOTA_BYTES = String(STORAGE_QUOTA_BYTES)

// exactly the bytes sniffMime inspects: a PNG signature plus filler, so the completed file is
// sniffed as image/png and enters the photo pipeline
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function pngish(size: number): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.alloc(size - PNG_MAGIC.length, 0x41)])
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface SessionCreated {
  uploadId: string
  chunkSizeBytes: number
  totalParts: number
  expiresAt: string
  status: string
}

interface StatusBody {
  status: string
  chunkSizeBytes: number
  totalParts: number
  receivedParts: number[]
  receivedBytes: number
  expiresAt: string
  assetId?: string
  fileId?: string
}

function auth(t: ApiTestApp, user: User) {
  return t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }))
}

async function createSession(
  t: ApiTestApp,
  user: User,
  body: {
    sizeBytes: number
    originalName?: string
    checksumSha256?: string
    title?: string
    description?: string
  },
): Promise<{ status: number; body: SessionCreated | Record<string, unknown> }> {
  const res = await request(apiServer(t))
    .post('/api/v1/uploads')
    .set(auth(t, user))
    .send({ originalName: 'clip.png', ...body })
  return { status: res.status, body: res.body as SessionCreated | Record<string, unknown> }
}

async function putPart(
  t: ApiTestApp,
  user: User,
  uploadId: string,
  index: number | string,
  body: Buffer,
  opts?: { sha?: string },
) {
  let req = request(apiServer(t))
    .put(`/api/v1/uploads/${uploadId}/parts/${index}`)
    .set(auth(t, user))
    .set('Content-Type', 'application/octet-stream')
  if (opts?.sha) req = req.set('X-Part-Sha256', opts.sha)
  return req.send(body)
}

async function sessionDirExists(t: ApiTestApp, userId: string, uploadId: string): Promise<boolean> {
  try {
    await stat(t.storage.pathFor(join('upload-sessions', userId, uploadId)))
    return true
  } catch {
    return false
  }
}

async function waitForJobId(
  t: ApiTestApp,
  queueName: string,
  jobId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now()
  const queue = t.getQueue(queueName)
  while (Date.now() - start < timeoutMs) {
    if (await queue.getJob(jobId)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

async function waitForJobWithAsset(
  t: ApiTestApp,
  queueName: string,
  assetId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now()
  const queue = t.getQueue(queueName)
  while (Date.now() - start < timeoutMs) {
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'])
    if (jobs.some((j) => (j.data as { assetId?: string }).assetId === assetId)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

describe('upload sessions', () => {
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

  it('assembles out-of-order parts into an asset and enqueues the photo pipeline', async () => {
    const user = await seedUser(t)
    const total = UPLOAD_CHUNK_SIZE_BYTES + 64
    const file = pngish(total)
    const head = file.subarray(0, UPLOAD_CHUNK_SIZE_BYTES)
    const tail = file.subarray(UPLOAD_CHUNK_SIZE_BYTES)

    const created = await createSession(t, user, {
      sizeBytes: total,
      checksumSha256: sha256(file),
      title: 'Beach',
      description: 'sunset',
    })
    expect(created.status).toBe(201)
    const session = created.body as SessionCreated
    expect(session.chunkSizeBytes).toBe(UPLOAD_CHUNK_SIZE_BYTES)
    expect(session.totalParts).toBe(2)
    expect(session.status).toBe('pending')

    // out of order: the tail lands first
    expect((await putPart(t, user, session.uploadId, 1, tail)).status).toBe(204)
    expect((await putPart(t, user, session.uploadId, 0, head)).status).toBe(204)

    const status = await request(apiServer(t))
      .get(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, user))
    expect(status.status).toBe(200)
    const statusBody = status.body as StatusBody
    expect(statusBody.status).toBe('pending')
    expect(statusBody.receivedParts).toEqual([0, 1])
    expect(statusBody.receivedBytes).toBe(total)

    const completed = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(completed.status).toBe(200)
    const body = completed.body as {
      asset: {
        id: string
        fileId: string
        kind: string
        title: string | null
        originalName: string | null
        sizeBytes: number | null
      }
      deduplicated: boolean
    }
    expect(body.deduplicated).toBe(false)
    expect(body.asset.kind).toBe('photo')
    expect(body.asset.title).toBe('Beach')
    expect(body.asset.originalName).toBe('clip.png')
    expect(body.asset.sizeBytes).toBe(total)

    const fileRow = await t.fileRepo.findOneOrFail({ where: { id: body.asset.fileId } })
    expect(fileRow.mimeType).toBe('image/png')
    expect(Number(fileRow.sizeBytes)).toBe(total)
    expect(fileRow.checksumSha256).toBe(sha256(file))
    expect(fileRow.storageKey.startsWith(`originals/${user.id}/`)).toBe(true)

    // the whole photo pipeline
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      expect(await waitForJobId(t, 'process-thumbnail', `thumb-${body.asset.id}-${size}`)).toBe(
        true,
      )
    }
    expect(await waitForJobWithAsset(t, 'process-metadata', body.asset.id)).toBe(true)
    expect(await waitForJobWithAsset(t, 'process-faces', body.asset.id)).toBe(true)
    expect(await waitForJobWithAsset(t, 'process-embeddings', body.asset.id)).toBe(true)
    expect(await waitForJobWithAsset(t, 'process-detect', body.asset.id)).toBe(true)

    // session is completed, its ids are stamped and the part bytes are gone
    const sessionRow = await t.uploadSessionRepo.findOneOrFail({
      where: { id: session.uploadId },
    })
    expect(sessionRow.status).toBe('completed')
    expect(sessionRow.completedAssetId).toBe(body.asset.id)
    expect(sessionRow.completedFileId).toBe(body.asset.fileId)
    expect(await sessionDirExists(t, user.id, session.uploadId)).toBe(false)

    const after = await request(apiServer(t))
      .get(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, user))
    expect((after.body as StatusBody).status).toBe('completed')
    expect((after.body as StatusBody).assetId).toBe(body.asset.id)
  }, 60_000)

  it('treats an identical re-PUT as a no-op', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, { sizeBytes: file.length })
    const session = created.body as SessionCreated

    expect((await putPart(t, user, session.uploadId, 0, file)).status).toBe(204)
    expect((await putPart(t, user, session.uploadId, 0, file)).status).toBe(204)
    expect(await t.uploadPartRepo.count({ where: { sessionId: session.uploadId } })).toBe(1)

    const conflicting = await putPart(t, user, session.uploadId, 0, Buffer.concat([file, file]))
    expect(conflicting.status).toBe(409)
    expect(conflicting.body).toMatchObject({ code: 'PART_CONFLICT' })

    const completed = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(completed.status).toBe(200)
  })

  it('replays a duplicate complete with deduplicated:true and no extra rows', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, { sizeBytes: file.length })
    const session = created.body as SessionCreated
    await putPart(t, user, session.uploadId, 0, file)

    const first = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(first.status).toBe(200)
    const firstBody = first.body as { asset: { id: string }; deduplicated: boolean }
    expect(firstBody.deduplicated).toBe(false)

    const second = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(second.status).toBe(200)
    const secondBody = second.body as { asset: { id: string }; deduplicated: boolean }
    expect(secondBody.deduplicated).toBe(true)
    expect(secondBody.asset.id).toBe(firstBody.asset.id)
    expect(await t.assetRepo.count()).toBe(1)
    expect(await t.fileRepo.count()).toBe(1)
  })

  it('409s PARTS_MISSING with the received indices when a part is absent', async () => {
    const user = await seedUser(t)
    const total = UPLOAD_CHUNK_SIZE_BYTES + 64
    const head = pngish(total).subarray(0, UPLOAD_CHUNK_SIZE_BYTES)
    const created = await createSession(t, user, { sizeBytes: total })
    const session = created.body as SessionCreated
    expect((await putPart(t, user, session.uploadId, 0, head)).status).toBe(204)

    const res = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ statusCode: 409, code: 'PARTS_MISSING', receivedParts: [0] })
    expect(await t.assetRepo.count()).toBe(0)

    const status = await request(apiServer(t))
      .get(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, user))
    expect((status.body as StatusBody).status).toBe('pending')
  }, 30_000)

  it('422s a declared checksum mismatch and persists nothing', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, {
      sizeBytes: file.length,
      checksumSha256: 'a'.repeat(64),
    })
    const session = created.body as SessionCreated
    await putPart(t, user, session.uploadId, 0, file)

    const res = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ statusCode: 422, code: 'CHECKSUM_MISMATCH' })
    expect(await t.fileRepo.count()).toBe(0)
    expect(await t.assetRepo.count()).toBe(0)
  })

  it('400s UNSUPPORTED_TYPE for bytes without a known magic', async () => {
    const user = await seedUser(t)
    const garbage = Buffer.alloc(64, 0x41)
    const created = await createSession(t, user, { sizeBytes: garbage.length })
    const session = created.body as SessionCreated
    await putPart(t, user, session.uploadId, 0, garbage)

    const res = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, code: 'UNSUPPORTED_TYPE' })
    expect(await t.fileRepo.count()).toBe(0)
    const sessionRow = await t.uploadSessionRepo.findOneOrFail({ where: { id: session.uploadId } })
    expect(sessionRow.status).toBe('failed')
    // the parts stay for DELETE to clean up
    expect(await t.uploadPartRepo.count({ where: { sessionId: session.uploadId } })).toBe(1)
  })

  it('enforces the quota authoritatively at complete with 413 QUOTA_EXCEEDED', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, { sizeBytes: file.length })
    const session = created.body as SessionCreated
    await putPart(t, user, session.uploadId, 0, file)

    // row-only prefill: only sizeBytes feeds the quota SUM, no 16 MiB upload needed
    await t.fileRepo.save(
      t.fileRepo.create({
        userId: user.id,
        storageKey: `originals/${user.id}/${randomUUID()}.bin`,
        originalName: 'big.bin',
        mimeType: 'image/png',
        sizeBytes: STORAGE_QUOTA_BYTES - 10,
        checksumSha256: randomUUID().replace(/-/g, '').padEnd(64, 'f'),
        purpose: 'original',
        assetId: null,
      }),
    )

    const res = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ statusCode: 413, code: 'QUOTA_EXCEEDED' })
    // nothing was persisted for the session's bytes and it stays retryable
    expect(await t.fileRepo.count({ where: { userId: user.id } })).toBe(1)
    expect(await t.assetRepo.count()).toBe(0)
  })

  it('caps active sessions per user with 409 SESSION_LIMIT', async () => {
    const user = await seedUser(t)
    for (let i = 0; i < UPLOAD_MAX_ACTIVE_SESSIONS; i++) {
      const res = await createSession(t, user, { sizeBytes: 64 })
      expect(res.status).toBe(201)
    }
    const sixth = await createSession(t, user, { sizeBytes: 64 })
    expect(sixth.status).toBe(409)
    expect(sixth.body).toMatchObject({ statusCode: 409, code: 'SESSION_LIMIT' })
  })

  it('rejects a size beyond 4 GiB with 413 SIZE_LIMIT', async () => {
    const user = await seedUser(t)
    const res = await createSession(t, user, { sizeBytes: 4 * 1024 * 1024 * 1024 + 1 })
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ statusCode: 413, code: 'SIZE_LIMIT' })
  })

  it('400s parts outside the session range and over the chunk size', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, { sizeBytes: file.length })
    const session = created.body as SessionCreated

    const outOfRange = await putPart(t, user, session.uploadId, 1, file)
    expect(outOfRange.status).toBe(400)
    expect(outOfRange.body).toMatchObject({ code: 'INDEX_RANGE' })

    // supertest sets Content-Length from the buffer, so an oversized part is refused by size
    const oversized = await putPart(
      t,
      user,
      session.uploadId,
      0,
      pngish(UPLOAD_CHUNK_SIZE_BYTES + 1),
    )
    expect(oversized.status).toBe(400)
    expect(oversized.body).toMatchObject({ code: 'PART_TOO_LARGE' })
  })

  it('404s every route for a foreign session and never deletes it', async () => {
    const owner = await seedUser(t)
    const stranger = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, owner, { sizeBytes: file.length })
    const session = created.body as SessionCreated
    await putPart(t, owner, session.uploadId, 0, file)

    const get = await request(apiServer(t))
      .get(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, stranger))
    expect(get.status).toBe(404)

    const put = await putPart(t, stranger, session.uploadId, 0, file)
    expect(put.status).toBe(404)

    const complete = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, stranger))
    expect(complete.status).toBe(404)

    const del = await request(apiServer(t))
      .delete(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, stranger))
    expect(del.status).toBe(204)
    expect(await t.uploadSessionRepo.count()).toBe(1)
    expect(await t.uploadPartRepo.count()).toBe(1)
  })

  it('410s a session past its TTL on GET, PUT and complete', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, { sizeBytes: file.length })
    const session = created.body as SessionCreated
    await t.uploadSessionRepo.update(
      { id: session.uploadId },
      { expiresAt: new Date(Date.now() - 1000) },
    )

    const get = await request(apiServer(t))
      .get(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, user))
    expect(get.status).toBe(410)
    expect(get.body).toMatchObject({ statusCode: 410, code: 'SESSION_EXPIRED' })

    const put = await putPart(t, user, session.uploadId, 0, file)
    expect(put.status).toBe(410)
    expect(put.body).toMatchObject({ code: 'SESSION_EXPIRED' })

    const complete = await request(apiServer(t))
      .post(`/api/v1/uploads/${session.uploadId}/complete`)
      .set(auth(t, user))
    expect(complete.status).toBe(410)
    expect(complete.body).toMatchObject({ code: 'SESSION_EXPIRED' })

    const row = await t.uploadSessionRepo.findOneOrFail({ where: { id: session.uploadId } })
    expect(row.status).toBe('expired')
  })

  it('sweeps a stale session through the advisory-locked sweeper', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, { sizeBytes: file.length })
    const session = created.body as SessionCreated
    await putPart(t, user, session.uploadId, 0, file)
    await t.uploadSessionRepo.update(
      { id: session.uploadId },
      { expiresAt: new Date(Date.now() - 1000) },
    )

    const sweeper = t.app.get(UploadSessionsSweeper)
    await expect(sweeper.sweep()).resolves.toMatchObject({ expired: 1 })

    const row = await t.uploadSessionRepo.findOneOrFail({ where: { id: session.uploadId } })
    expect(row.status).toBe('expired')
    expect(await sessionDirExists(t, user.id, session.uploadId)).toBe(false)
  })

  it('DELETE removes the row, the cascade parts and the session directory', async () => {
    const user = await seedUser(t)
    const file = pngish(64)
    const created = await createSession(t, user, { sizeBytes: file.length })
    const session = created.body as SessionCreated
    await putPart(t, user, session.uploadId, 0, file)
    expect(await sessionDirExists(t, user.id, session.uploadId)).toBe(true)

    const res = await request(apiServer(t))
      .delete(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, user))
    expect(res.status).toBe(204)
    expect(await t.uploadSessionRepo.count({ where: { id: session.uploadId } })).toBe(0)
    expect(await t.uploadPartRepo.count({ where: { sessionId: session.uploadId } })).toBe(0)
    expect(await sessionDirExists(t, user.id, session.uploadId)).toBe(false)

    const again = await request(apiServer(t))
      .delete(`/api/v1/uploads/${session.uploadId}`)
      .set(auth(t, user))
    expect(again.status).toBe(204)
  })
})
