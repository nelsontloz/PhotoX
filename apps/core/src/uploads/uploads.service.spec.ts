import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Request } from 'express'
import type { DataSource, Repository } from 'typeorm'
import type { LocalStorageService } from '@photox/shared-config'
import type { Asset as AssetResponse } from '@photox/shared-types'
import { UploadSession, UploadSessionPart } from '../database/entities'
import type { Asset } from '../database/entities'
import type { AssetsService } from '../assets/assets.service'
import type { UserFilesService } from '../files/user/user-files.service'
import {
  UPLOAD_CHUNK_SIZE_BYTES,
  UPLOAD_MAX_ACTIVE_SESSIONS,
  UPLOAD_MAX_SIZE_BYTES,
  UPLOAD_PENDING_TTL_MS,
  UploadsService,
} from './uploads.service'
import { readPartBody } from './uploads.controller'
import { UPLOAD_SWEEP_INTERVAL_MS, UploadSessionsSweeper } from './upload-sessions.sweeper'
import type { CreateUploadSessionBodyDto } from './dto/create-upload-session.body.dto'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
// exactly the 12 bytes sniffMime reads — a valid JPEG head
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

let storageRoot: string

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'uploads-spec-'))
  process.env.STORAGE_DIR = storageRoot
})

afterEach(async () => {
  delete process.env.STORAGE_DIR
  delete process.env.STORAGE_QUOTA_BYTES
  await rm(storageRoot, { recursive: true, force: true })
})

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sessionRow(partial: Partial<UploadSession> & { id: string }): UploadSession {
  const row = new UploadSession()
  Object.assign(row, {
    userId: USER,
    status: 'pending',
    chunkSizeBytes: UPLOAD_CHUNK_SIZE_BYTES,
    totalParts: 1,
    expectedSizeBytes: JPEG.length,
    checksumSha256: null,
    originalName: 'pic.jpg',
    title: null,
    description: null,
    takenAt: null,
    expiresAt: new Date(Date.now() + UPLOAD_PENDING_TTL_MS),
    completedFileId: null,
    completedAssetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies Partial<UploadSession>)
  Object.assign(row, partial)
  return row
}

function partRow(opts: {
  sessionId: string
  partIndex: number
  bytes?: Buffer
  sizeBytes?: number
  checksumSha256?: string
}): UploadSessionPart {
  const bytes = opts.bytes ?? JPEG
  return {
    sessionId: opts.sessionId,
    partIndex: opts.partIndex,
    sizeBytes: opts.sizeBytes ?? bytes.length,
    checksumSha256: opts.checksumSha256 ?? sha256(bytes),
  } as UploadSessionPart
}

function sessionDir(userId: string, sessionId: string): string {
  return join(storageRoot, 'upload-sessions', userId, sessionId)
}

async function writePartFiles(session: UploadSession, bodies: Buffer[]): Promise<void> {
  await mkdir(sessionDir(session.userId, session.id), { recursive: true })
  for (const [index, body] of bodies.entries()) {
    await writeFile(join(sessionDir(session.userId, session.id), `part-${index}`), body)
  }
}

function fakeReq(opts: { body?: Buffer; contentLength?: string }): Request {
  const stream = new Readable({
    read() {
      if (opts.body) this.push(opts.body)
      this.push(null)
    },
  })
  return Object.assign(stream, {
    headers: opts.contentLength === undefined ? {} : { 'content-length': opts.contentLength },
  }) as unknown as Request
}

interface Scenario {
  sessions?: UploadSession[]
  parts?: UploadSessionPart[]
  existingAsset?: Asset | null
  persist?: { record: { id: string; mimeType: string }; created: boolean }
  asset?: AssetResponse
  quotaUsed?: number
  activeCount?: number
}

function makeService(scenario: Scenario = {}) {
  const sessions = scenario.sessions ?? []
  const parts = scenario.parts ?? []
  const updates: Record<string, unknown>[] = []
  const sessionFinds: { where?: unknown[] }[] = []

  const manager = {
    findOne: vi.fn((entity: unknown, opts?: { where?: Record<string, unknown> }) => {
      const where = opts?.where ?? {}
      if (entity === UploadSession) {
        return Promise.resolve(
          sessions.find(
            (s) =>
              (where.id === undefined || s.id === where.id) &&
              (where.userId === undefined || s.userId === where.userId),
          ) ?? null,
        )
      }
      return Promise.resolve(
        parts.find(
          (p) =>
            (where.sessionId === undefined || p.sessionId === where.sessionId) &&
            (where.partIndex === undefined || p.partIndex === where.partIndex),
        ) ?? null,
      )
    }),
    find: vi.fn(() => Promise.resolve(parts)),
    insert: vi.fn(() => Promise.resolve({ identifiers: [] })),
    update: vi.fn((_entity: unknown, _where: unknown, values: Record<string, unknown>) => {
      updates.push(values)
      return Promise.resolve({ affected: 1 })
    }),
  }

  let transactionActive = false
  const runner = {
    connect: vi.fn(() => Promise.resolve()),
    startTransaction: vi.fn(() => {
      transactionActive = true
      return Promise.resolve()
    }),
    commitTransaction: vi.fn(() => {
      transactionActive = false
      return Promise.resolve()
    }),
    rollbackTransaction: vi.fn(() => {
      transactionActive = false
      return Promise.resolve()
    }),
    release: vi.fn(() => Promise.resolve()),
    manager,
    get isTransactionActive() {
      return transactionActive
    },
  }

  const sessionRepo = {
    findOne: vi.fn((opts?: { where?: { id?: string; userId?: string } }) =>
      Promise.resolve(
        sessions.find(
          (s) =>
            (opts?.where?.id === undefined || s.id === opts.where.id) &&
            (opts?.where?.userId === undefined || s.userId === opts.where.userId),
        ) ?? null,
      ),
    ),
    find: vi.fn((opts?: { where?: unknown[] }) => {
      sessionFinds.push(opts ?? {})
      return Promise.resolve([] as UploadSession[])
    }),
    count: vi.fn(() => Promise.resolve(scenario.activeCount ?? 0)),
    save: vi.fn((row: UploadSession) => Promise.resolve(row)),
    update: vi.fn((where: { id: string }, values: Record<string, unknown>) => {
      updates.push(values)
      const row = sessions.find((s) => s.id === where.id)
      if (row) Object.assign(row, values)
      return Promise.resolve({ affected: 1 })
    }),
    delete: vi.fn(() => Promise.resolve({ affected: 1 })),
  }
  const partRepo = {
    findOne: vi.fn((opts?: { where?: { sessionId?: string; partIndex?: number } }) =>
      Promise.resolve(
        parts.find(
          (p) =>
            (opts?.where?.sessionId === undefined || p.sessionId === opts.where.sessionId) &&
            (opts?.where?.partIndex === undefined || p.partIndex === opts.where.partIndex),
        ) ?? null,
      ),
    ),
    find: vi.fn(() => Promise.resolve(parts)),
  }
  const assetRepo = { findOne: vi.fn(() => Promise.resolve(scenario.existingAsset ?? null)) }
  const storage = {
    pathFor: vi.fn((key: string) => join(storageRoot, key)),
  } as unknown as LocalStorageService

  const persistOriginal = vi.fn(() =>
    Promise.resolve(
      scenario.persist ?? { record: { id: 'file-new', mimeType: 'image/jpeg' }, created: true },
    ),
  )
  const createAsset = vi.fn(() =>
    Promise.resolve(scenario.asset ?? ({ id: 'asset-new' } as AssetResponse)),
  )
  const enqueueAssetJobs = vi.fn(() => Promise.resolve())
  const userFiles = {
    storageQuota: vi.fn(() => Promise.resolve({ usedBytes: scenario.quotaUsed ?? 0 })),
    persistOriginal,
    createAsset,
    enqueueAssetJobs,
    getOne: vi.fn(() => Promise.resolve({ id: 'file-new', mimeType: 'image/jpeg' })),
  } as unknown as UserFilesService
  const assetsGetOne = vi.fn(() =>
    Promise.resolve(scenario.asset ?? ({ id: 'asset-existing' } as AssetResponse)),
  )
  const assets = { getOne: assetsGetOne } as unknown as AssetsService

  const service = new UploadsService(
    sessionRepo as unknown as Repository<UploadSession>,
    partRepo as unknown as Repository<UploadSessionPart>,
    assetRepo as unknown as Repository<Asset>,
    { createQueryRunner: () => runner } as unknown as DataSource,
    storage,
    userFiles,
    assets,
  )
  return {
    service,
    sessionRepo,
    sessionFinds,
    partRepo,
    assetRepo,
    manager,
    runner,
    runnerCommits: runner.commitTransaction,
    updates,
    persistOriginal,
    createAsset,
    enqueueAssetJobs,
    assets,
    assetsGetOne,
  }
}

interface ErrorShape {
  getStatus: () => number
  getResponse: () => unknown
}

async function caught(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn()
  } catch (err) {
    const shape = err as ErrorShape
    return { status: shape.getStatus(), body: shape.getResponse() }
  }
  throw new Error('expected the call to throw')
}

describe('UploadsService.create', () => {
  function createBody(
    partial: Partial<CreateUploadSessionBodyDto> = {},
  ): CreateUploadSessionBodyDto {
    return { sizeBytes: JPEG.length, originalName: 'pic.jpg', ...partial }
  }

  it('rejects a size below 1 byte with 413 SIZE_LIMIT', async () => {
    const { service } = makeService()
    const { status, body } = await caught(() => service.create(USER, createBody({ sizeBytes: 0 })))
    expect(status).toBe(413)
    expect(body).toMatchObject({ statusCode: 413, code: 'SIZE_LIMIT' })
  })

  it('rejects a size above 4 GiB with 413 SIZE_LIMIT', async () => {
    const { service } = makeService()
    const { status, body } = await caught(() =>
      service.create(USER, createBody({ sizeBytes: UPLOAD_MAX_SIZE_BYTES + 1 })),
    )
    expect(status).toBe(413)
    expect(body).toMatchObject({ code: 'SIZE_LIMIT' })
  })

  it('derives totalParts from the fixed 8 MiB chunk size', async () => {
    const { service, sessionRepo } = makeService()
    const created = await service.create(
      USER,
      createBody({ sizeBytes: UPLOAD_CHUNK_SIZE_BYTES * 2 + 1 }),
    )
    expect(created.chunkSizeBytes).toBe(UPLOAD_CHUNK_SIZE_BYTES)
    expect(created.totalParts).toBe(3)
    expect(created.status).toBe('pending')
    const saved = sessionRepo.save.mock.calls[0]?.[0]
    expect(saved?.id).toBe(created.uploadId)
    expect(saved?.userId).toBe(USER)
    expect(Number(saved?.expectedSizeBytes)).toBe(UPLOAD_CHUNK_SIZE_BYTES * 2 + 1)
    expect(saved?.checksumSha256).toBeNull()
  })

  it('stores a lowercased declared checksum', async () => {
    const { service, sessionRepo } = makeService()
    await service.create(USER, createBody({ checksumSha256: 'A'.repeat(64) }))
    expect(sessionRepo.save.mock.calls[0]?.[0]?.checksumSha256).toBe('a'.repeat(64))
  })

  it('rejects an advisory quota overflow with 413 QUOTA_EXCEEDED', async () => {
    process.env.STORAGE_QUOTA_BYTES = '1000'
    const { service } = makeService({ quotaUsed: 900 })
    const { status, body } = await caught(() =>
      service.create(USER, createBody({ sizeBytes: 200 })),
    )
    expect(status).toBe(413)
    expect(body).toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })

  it('allows a size that exactly fills the remaining quota', async () => {
    process.env.STORAGE_QUOTA_BYTES = '1000'
    const { service } = makeService({ quotaUsed: 900 })
    const created = await service.create(USER, createBody({ sizeBytes: 100 }))
    expect(created.uploadId).toBeTruthy()
  })

  it('rejects the sixth active session with 409 SESSION_LIMIT', async () => {
    const { service } = makeService({ activeCount: UPLOAD_MAX_ACTIVE_SESSIONS })
    const { status, body } = await caught(() => service.create(USER, createBody()))
    expect(status).toBe(409)
    expect(body).toMatchObject({ statusCode: 409, code: 'SESSION_LIMIT' })
  })

  it('allows a new session while the cap is not reached', async () => {
    const { service } = makeService({ activeCount: UPLOAD_MAX_ACTIVE_SESSIONS - 1 })
    const created = await service.create(USER, createBody())
    expect(created.status).toBe('pending')
  })
})

describe('UploadsService.putPart', () => {
  it('stores a part file and row', async () => {
    const session = sessionRow({ id: randomUUID() })
    const { service, manager } = makeService({ sessions: [session] })
    await service.putPart(USER, session.id, '0', JPEG, null)
    expect(manager.insert).toHaveBeenCalledOnce()
    const stored = await readFile(join(sessionDir(USER, session.id), 'part-0'))
    expect(stored.equals(JPEG)).toBe(true)
  })

  it('returns without writing for an identical re-PUT', async () => {
    const session = sessionRow({ id: randomUUID() })
    const parts = [partRow({ sessionId: session.id, partIndex: 0 })]
    const { service, manager } = makeService({ sessions: [session], parts })
    await writePartFiles(session, [JPEG])
    await service.putPart(USER, session.id, '0', JPEG, null)
    expect(manager.insert).not.toHaveBeenCalled()
    expect(manager.update).not.toHaveBeenCalled()
  })

  it('conflicts when the same index is re-PUT with different bytes', async () => {
    const session = sessionRow({ id: randomUUID() })
    const parts = [partRow({ sessionId: session.id, partIndex: 0 })]
    const { service } = makeService({ sessions: [session], parts })
    const { status, body } = await caught(() =>
      service.putPart(USER, session.id, '0', Buffer.concat([JPEG, Buffer.from('x')]), null),
    )
    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'PART_CONFLICT' })
  })

  it('rejects an out-of-range index with 400 INDEX_RANGE', async () => {
    const session = sessionRow({ id: randomUUID(), totalParts: 2, expectedSizeBytes: 24 })
    const { service } = makeService({ sessions: [session] })
    const { status, body } = await caught(() => service.putPart(USER, session.id, '2', JPEG, null))
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'INDEX_RANGE' })
  })

  it('rejects a negative index with 400 INDEX_RANGE', async () => {
    const { service } = makeService()
    const { status, body } = await caught(() =>
      service.putPart(USER, randomUUID(), '-1', JPEG, null),
    )
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'INDEX_RANGE' })
  })

  it('rejects an oversized part with 400 PART_TOO_LARGE', async () => {
    const session = sessionRow({ id: randomUUID() })
    const { service } = makeService({ sessions: [session] })
    const { status, body } = await caught(() =>
      service.putPart(USER, session.id, '0', Buffer.alloc(UPLOAD_CHUNK_SIZE_BYTES + 1), null),
    )
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'PART_TOO_LARGE' })
  })

  it('rejects a mismatching X-Part-Sha256 with 409 PART_CONFLICT', async () => {
    const session = sessionRow({ id: randomUUID() })
    const { service } = makeService({ sessions: [session] })
    const { status, body } = await caught(() =>
      service.putPart(USER, session.id, '0', JPEG, 'f'.repeat(64)),
    )
    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'PART_CONFLICT' })
  })

  it('accepts a matching X-Part-Sha256', async () => {
    const session = sessionRow({ id: randomUUID() })
    const { service, manager } = makeService({ sessions: [session] })
    await service.putPart(USER, session.id, '0', JPEG, sha256(JPEG).toUpperCase())
    expect(manager.insert).toHaveBeenCalledOnce()
  })

  it('404s a session owned by another user', async () => {
    const session = sessionRow({ id: randomUUID(), userId: OTHER_USER })
    const { service } = makeService({ sessions: [session] })
    const { status } = await caught(() => service.putPart(USER, session.id, '0', JPEG, null))
    expect(status).toBe(404)
  })

  it('410s an expired session, parks it and drops its bytes', async () => {
    const session = sessionRow({ id: randomUUID(), expiresAt: new Date(Date.now() - 1000) })
    const { service, updates, runnerCommits } = makeService({ sessions: [session] })
    await writePartFiles(session, [JPEG])
    const { status, body } = await caught(() => service.putPart(USER, session.id, '0', JPEG, null))
    expect(status).toBe(410)
    expect(body).toMatchObject({ code: 'SESSION_EXPIRED' })
    // parked through the locked runner, and committed rather than rolled back
    expect(updates).toContainEqual({ status: 'expired' })
    expect(runnerCommits).toHaveBeenCalled()
    await expect(stat(sessionDir(USER, session.id))).rejects.toThrow()
  })

  it('refuses parts once the session is completed', async () => {
    const session = sessionRow({ id: randomUUID(), status: 'completed' })
    const { service } = makeService({ sessions: [session] })
    const { status, body } = await caught(() => service.putPart(USER, session.id, '0', JPEG, null))
    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'PART_CONFLICT' })
  })
})

describe('readPartBody', () => {
  it('400s without Content-Length', async () => {
    const { status, body } = await caught(() => readPartBody(fakeReq({ body: JPEG }), 100))
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'MISSING_LENGTH' })
  })

  it('400s a zero-length declaration', async () => {
    const { status, body } = await caught(() =>
      readPartBody(fakeReq({ body: Buffer.alloc(0), contentLength: '0' }), 100),
    )
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'PART_TOO_LARGE' })
  })

  it('400s an oversized declaration before buffering', async () => {
    const { status, body } = await caught(() =>
      readPartBody(fakeReq({ body: Buffer.alloc(200), contentLength: '200' }), 100),
    )
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'PART_TOO_LARGE' })
  })

  it('400s a body that outgrows the cap while streaming', async () => {
    const { status, body } = await caught(() =>
      readPartBody(fakeReq({ body: Buffer.alloc(200), contentLength: '100' }), 100),
    )
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'PART_TOO_LARGE' })
  })

  it('returns the buffered bytes for a valid part', async () => {
    await expect(readPartBody(fakeReq({ body: JPEG, contentLength: '12' }), 100)).resolves.toEqual(
      JPEG,
    )
  })
})

describe('UploadsService.complete', () => {
  const PERSIST_OK = { record: { id: 'file-new', mimeType: 'image/jpeg' }, created: true }
  const ASSET = { id: 'asset-1' } as AssetResponse

  it('409s PARTS_MISSING with the received indices', async () => {
    const session = sessionRow({ id: randomUUID(), totalParts: 2, expectedSizeBytes: 24 })
    const parts = [partRow({ sessionId: session.id, partIndex: 1 })]
    const { service, persistOriginal } = makeService({ sessions: [session], parts })
    const { status, body } = await caught(() => service.complete(USER, session.id))
    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'PARTS_MISSING', receivedParts: [1] })
    expect(persistOriginal).not.toHaveBeenCalled()
  })

  it('409s PARTS_MISSING when every index is present but the total size is wrong', async () => {
    const session = sessionRow({ id: randomUUID(), totalParts: 1, expectedSizeBytes: 99 })
    const parts = [partRow({ sessionId: session.id, partIndex: 0 })]
    const { service } = makeService({ sessions: [session], parts })
    const { status, body } = await caught(() => service.complete(USER, session.id))
    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'PARTS_MISSING' })
  })

  it('422s CHECKSUM_MISMATCH and persists nothing', async () => {
    const session = sessionRow({ id: randomUUID(), checksumSha256: 'a'.repeat(64) })
    const parts = [partRow({ sessionId: session.id, partIndex: 0 })]
    const { service, persistOriginal } = makeService({ sessions: [session], parts })
    await writePartFiles(session, [JPEG])
    const { status, body } = await caught(() => service.complete(USER, session.id))
    expect(status).toBe(422)
    expect(body).toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    expect(persistOriginal).not.toHaveBeenCalled()
  })

  it('400s UNSUPPORTED_TYPE for bytes without a known magic and parks the session failed', async () => {
    const session = sessionRow({ id: randomUUID() })
    const parts = [partRow({ sessionId: session.id, partIndex: 0, bytes: Buffer.alloc(12, 0x41) })]
    const { service, updates, persistOriginal } = makeService({ sessions: [session], parts })
    await writePartFiles(session, [Buffer.alloc(12, 0x41)])
    const { status, body } = await caught(() => service.complete(USER, session.id))
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'UNSUPPORTED_TYPE' })
    expect(persistOriginal).not.toHaveBeenCalled()
    expect(updates).toContainEqual({ status: 'failed' })
  })

  it('assembles, creates the asset and enqueues the jobs', async () => {
    const session = sessionRow({ id: randomUUID() })
    const parts = [partRow({ sessionId: session.id, partIndex: 0 })]
    const { service, updates, persistOriginal, createAsset, enqueueAssetJobs, sessionRepo } =
      makeService({ sessions: [session], parts, persist: PERSIST_OK, asset: ASSET })
    await writePartFiles(session, [JPEG])
    const res = await service.complete(USER, session.id)
    expect(res.asset.id).toBe(ASSET.id)
    expect(res.deduplicated).toBe(false)
    expect(persistOriginal).toHaveBeenCalledOnce()
    expect(createAsset).toHaveBeenCalledOnce()
    expect(enqueueAssetJobs).toHaveBeenCalledWith(USER, { id: 'file-new' }, 'photo', 'asset-1')
    expect(updates).toContainEqual({ status: 'assembling' })
    expect(updates).toContainEqual({
      status: 'assembled',
      completedFileId: 'file-new',
      completedAssetId: 'asset-1',
    })
    expect(sessionRepo.update).toHaveBeenCalledWith({ id: session.id }, { status: 'completed' })
    // the parts directory is gone once the session completed
    await expect(stat(sessionDir(USER, session.id))).rejects.toThrow()
  })

  it('replays onto a pre-existing asset when the checksum was already owned', async () => {
    const session = sessionRow({ id: randomUUID() })
    const parts = [partRow({ sessionId: session.id, partIndex: 0 })]
    const { service, assetRepo, assetsGetOne, createAsset } = makeService({
      sessions: [session],
      parts,
      persist: { record: { id: 'file-dup', mimeType: 'image/jpeg' }, created: false },
      existingAsset: { id: 'asset-dup' } as Asset,
      asset: { id: 'asset-dup' } as AssetResponse,
    })
    await writePartFiles(session, [JPEG])
    const res = await service.complete(USER, session.id)
    expect(assetRepo.findOne).toHaveBeenCalledOnce()
    expect(assetsGetOne).toHaveBeenCalledWith(USER, 'asset-dup')
    expect(createAsset).not.toHaveBeenCalled()
    expect(res.deduplicated).toBe(true)
  })

  it('replays a duplicate complete without reassembling', async () => {
    const session = sessionRow({
      id: randomUUID(),
      status: 'completed',
      completedFileId: 'file-1',
      completedAssetId: 'asset-1',
    })
    const { service, persistOriginal, enqueueAssetJobs } = makeService({
      sessions: [session],
      asset: ASSET,
    })
    const res = await service.complete(USER, session.id)
    expect(res.deduplicated).toBe(true)
    expect(res.asset.id).toBe(ASSET.id)
    expect(persistOriginal).not.toHaveBeenCalled()
    expect(enqueueAssetJobs).not.toHaveBeenCalled()
  })

  it('503s ENQUEUE_FAILED and leaves the session assembled and retryable', async () => {
    const session = sessionRow({ id: randomUUID() })
    const parts = [partRow({ sessionId: session.id, partIndex: 0 })]
    const { service, updates, enqueueAssetJobs, sessionRepo } = makeService({
      sessions: [session],
      parts,
      persist: PERSIST_OK,
      asset: ASSET,
    })
    enqueueAssetJobs.mockRejectedValueOnce(new Error('redis down'))
    await writePartFiles(session, [JPEG])
    const { status, body } = await caught(() => service.complete(USER, session.id))
    expect(status).toBe(503)
    expect(body).toMatchObject({ code: 'ENQUEUE_FAILED' })
    // the assembled stamp is durable, `completed` was never written and the parts survive
    expect(updates).toContainEqual({
      status: 'assembled',
      completedFileId: 'file-new',
      completedAssetId: 'asset-1',
    })
    expect(sessionRepo.update).not.toHaveBeenCalledWith({ id: session.id }, { status: 'completed' })
    await expect(stat(join(sessionDir(USER, session.id), 'part-0'))).resolves.toBeTruthy()
  })

  it('retries only the enqueues for an assembled session', async () => {
    const session = sessionRow({
      id: randomUUID(),
      status: 'assembled',
      completedFileId: 'file-1',
      completedAssetId: 'asset-1',
    })
    const { service, persistOriginal, createAsset, enqueueAssetJobs, sessionRepo } = makeService({
      sessions: [session],
      asset: ASSET,
    })
    const res = await service.complete(USER, session.id)
    expect(persistOriginal).not.toHaveBeenCalled()
    expect(createAsset).not.toHaveBeenCalled()
    expect(enqueueAssetJobs).toHaveBeenCalledWith(USER, { id: 'file-1' }, 'photo', 'asset-1')
    expect(sessionRepo.update).toHaveBeenCalledWith({ id: session.id }, { status: 'completed' })
    expect(res.asset.id).toBe(ASSET.id)
  })

  it('410s an expired session', async () => {
    const session = sessionRow({ id: randomUUID(), expiresAt: new Date(Date.now() - 1000) })
    const { service } = makeService({ sessions: [session] })
    const { status, body } = await caught(() => service.complete(USER, session.id))
    expect(status).toBe(410)
    expect(body).toMatchObject({ code: 'SESSION_EXPIRED' })
  })

  it('404s a session owned by another user', async () => {
    const session = sessionRow({ id: randomUUID(), userId: OTHER_USER })
    const { service } = makeService({ sessions: [session] })
    const { status } = await caught(() => service.complete(USER, session.id))
    expect(status).toBe(404)
  })

  it('404s a malformed session id without touching the database', async () => {
    const { service, runner } = makeService()
    const { status } = await caught(() => service.complete(USER, 'not-a-uuid'))
    expect(status).toBe(404)
    expect(runner.connect).not.toHaveBeenCalled()
  })
})

describe('UploadsService.status', () => {
  it('reports the received parts and the derived byte count', async () => {
    const session = sessionRow({ id: randomUUID(), totalParts: 3, expectedSizeBytes: 36 })
    const parts = [
      partRow({ sessionId: session.id, partIndex: 2 }),
      partRow({ sessionId: session.id, partIndex: 0 }),
    ]
    const { service } = makeService({ sessions: [session], parts })
    const res = await service.status(USER, session.id)
    expect(res).toMatchObject({
      status: 'pending',
      totalParts: 3,
      receivedParts: [0, 2],
      receivedBytes: JPEG.length * 2,
    })
  })

  it('exposes the ids once the session completed', async () => {
    const session = sessionRow({
      id: randomUUID(),
      status: 'completed',
      completedFileId: 'file-1',
      completedAssetId: 'asset-1',
    })
    const { service } = makeService({ sessions: [session] })
    await expect(service.status(USER, session.id)).resolves.toMatchObject({
      status: 'completed',
      fileId: 'file-1',
      assetId: 'asset-1',
    })
  })

  it('410s a session past its pending TTL and parks it', async () => {
    const session = sessionRow({ id: randomUUID(), expiresAt: new Date(Date.now() - 1000) })
    const { service, sessionRepo } = makeService({ sessions: [session] })
    const { status, body } = await caught(() => service.status(USER, session.id))
    expect(status).toBe(410)
    expect(body).toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(sessionRepo.update).toHaveBeenCalledWith({ id: session.id }, { status: 'expired' })
  })

  it('410s a session already parked as expired', async () => {
    const session = sessionRow({ id: randomUUID(), status: 'expired' })
    const { service } = makeService({ sessions: [session] })
    const { status } = await caught(() => service.status(USER, session.id))
    expect(status).toBe(410)
  })

  it('404s a foreign session', async () => {
    const session = sessionRow({ id: randomUUID(), userId: OTHER_USER })
    const { service } = makeService({ sessions: [session] })
    const { status } = await caught(() => service.status(USER, session.id))
    expect(status).toBe(404)
  })
})

describe('UploadsService.remove', () => {
  it('deletes the row and the session directory', async () => {
    const session = sessionRow({ id: randomUUID() })
    const { service, sessionRepo } = makeService({ sessions: [session] })
    await writePartFiles(session, [JPEG])
    await service.remove(USER, session.id)
    expect(sessionRepo.delete).toHaveBeenCalledWith({ id: session.id })
    await expect(stat(sessionDir(USER, session.id))).rejects.toThrow()
  })

  it('is idempotent for unknown and malformed ids', async () => {
    const { service, sessionRepo } = makeService()
    await service.remove(USER, randomUUID())
    await service.remove(USER, 'not-a-uuid')
    expect(sessionRepo.delete).not.toHaveBeenCalled()
  })

  it('does not delete a foreign session', async () => {
    const session = sessionRow({ id: randomUUID(), userId: OTHER_USER })
    const { service, sessionRepo } = makeService({ sessions: [session] })
    await service.remove(USER, session.id)
    expect(sessionRepo.delete).not.toHaveBeenCalled()
  })
})

describe('UploadsService.purgeExpired', () => {
  it('parks stale sessions and drops their bytes', async () => {
    const session = sessionRow({ id: randomUUID(), expiresAt: new Date(Date.now() - 1000) })
    const { service, sessionRepo } = makeService({ sessions: [session] })
    sessionRepo.find.mockResolvedValueOnce([session])
    await writePartFiles(session, [JPEG])
    await expect(service.purgeExpired()).resolves.toEqual({ expired: 1 })
    expect(sessionRepo.update).toHaveBeenCalledWith({ id: session.id }, { status: 'expired' })
    await expect(stat(sessionDir(USER, session.id))).rejects.toThrow()
  })

  it('reports nothing when no session is stale', async () => {
    const { service, sessionRepo } = makeService()
    await expect(service.purgeExpired()).resolves.toEqual({ expired: 0 })
    expect(sessionRepo.update).not.toHaveBeenCalled()
  })

  it('collects failed sessions only in the global sweep', async () => {
    const { service, sessionFinds } = makeService()
    await service.purgeExpired()
    const where = sessionFinds[0]?.where as Record<string, unknown>[]
    expect(where.some((condition) => condition.status === 'failed')).toBe(true)
    expect(where.every((condition) => condition.userId === undefined)).toBe(true)
  })

  it('scopes the user sweep and leaves that user failed sessions alone', async () => {
    const { service, sessionFinds } = makeService()
    await service.purgeExpired(USER)
    const where = sessionFinds[0]?.where as Record<string, unknown>[]
    expect(where).toHaveLength(2)
    expect(where.every((condition) => condition.userId === USER)).toBe(true)
    expect(where.some((condition) => condition.status === 'failed')).toBe(false)
  })
})

describe('UploadSessionsSweeper', () => {
  function makeSweeper(locked: boolean) {
    const purge = vi.fn(() => Promise.resolve({ expired: 3 }))
    const runner = {
      connect: vi.fn(() => Promise.resolve()),
      query: vi.fn(() => Promise.resolve([{ locked }])),
      release: vi.fn(() => Promise.resolve()),
    }
    const sweeper = new UploadSessionsSweeper(
      { purgeExpired: purge } as unknown as UploadsService,
      { createQueryRunner: () => runner } as unknown as DataSource,
    )
    return { sweeper, purge, runner }
  }

  it('purges while holding the advisory lock, then releases it', async () => {
    const { sweeper, purge, runner } = makeSweeper(true)
    await expect(sweeper.sweep()).resolves.toEqual({ expired: 3 })
    expect(purge).toHaveBeenCalledOnce()
    // one lock + one unlock on the same pinned connection
    expect(runner.query).toHaveBeenCalledTimes(2)
    expect(runner.release).toHaveBeenCalledOnce()
  })

  it('skips the sweep when another instance holds the lock', async () => {
    const { sweeper, purge, runner } = makeSweeper(false)
    await expect(sweeper.sweep()).resolves.toEqual({ expired: 0, skipped: true })
    expect(purge).not.toHaveBeenCalled()
    expect(runner.release).toHaveBeenCalledOnce()
  })

  it('starts a 15 minute timer and clears it on destroy', () => {
    const { sweeper } = makeSweeper(true)
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    sweeper.onModuleInit()
    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), UPLOAD_SWEEP_INTERVAL_MS)
    sweeper.onModuleDestroy()
    expect(clearSpy).toHaveBeenCalled()
    setSpy.mockRestore()
    clearSpy.mockRestore()
  })
})
