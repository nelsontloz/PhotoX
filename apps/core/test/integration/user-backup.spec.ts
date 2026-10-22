import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  type INestApplication,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm'
import { vi } from 'vitest'
import { Worker } from 'bullmq'
import {
  LocalStorageService,
  backupPrefix,
  loadEnv,
  manifestKey,
  originalKey,
} from '@photox/shared-config'
import { DataSource, In, type Repository } from 'typeorm'
import { Asset, AssetThumbnail, Face, FileRecord, Person } from '../../src/database/entities'
import { AppSetting } from '../../src/database/entities/app-setting.entity'
import { AssetEmbedding } from '../../src/database/entities/asset-embedding.entity'
import { AssetOcr } from '../../src/database/entities/asset-ocr.entity'
import { AssetDetection } from '../../src/database/entities/asset-detection.entity'
import { Place } from '../../src/database/entities/place.entity'
import { Album } from '../../src/albums/entities/album.entity'
import { AlbumAsset } from '../../src/albums/entities/album-asset.entity'
import { Share } from '../../src/shares/entities/share.entity'
import { User } from '../../src/users/entities/user.entity'
import { RefreshToken } from '../../src/users/entities/refresh-token.entity'
import { BackupModule } from '../../src/backup/backup.module'
import { BackupMerge } from '../../src/backup/entities/backup-merge.entity'
import { S3BackupService } from '../../src/backup/s3-backup.service'
import {
  UserBackupService,
  buildFallbackEmail,
  type UserBackupManifest,
} from '../../src/backup/user-backup.service'
import { BullMqModule } from '../../src/queue/bullmq.module'
import { BullMqService } from '../../src/queue/bullmq.service'
import { setupTestInfra, teardownTestInfra } from './test-setup'

const ENTITIES = [
  User,
  RefreshToken,
  Album,
  AlbumAsset,
  Share,
  FileRecord,
  Asset,
  AssetThumbnail,
  Face,
  Person,
  AppSetting,
  AssetEmbedding,
  AssetOcr,
  AssetDetection,
  Place,
  BackupMerge,
]

interface FakeOp {
  op: 'putObject' | 'putFile' | 'deleteKey' | 'copyKey'
  key: string
}

/**
 * In-memory S3BackupService stand-in — backup specs never need Floci/docker.
 * Records put order so M3 (bytes first, manifest last) is assertable, and can
 * inject a mid-run putFile failure for the rerun-after-failure case.
 */
class FakeS3BackupService {
  objects = new Map<string, Buffer>()

  ops: FakeOp[] = []

  failNextPuts = 0

  failNextCopies = 0

  failListKeys = false

  async ensureBucket(): Promise<void> {
    // in-memory stand-in — nothing to provision
  }

  putObject(key: string, body: Buffer): Promise<void> {
    this.ops.push({ op: 'putObject', key })
    this.objects.set(key, Buffer.from(body))
    return Promise.resolve()
  }

  async putFile(key: string, localPath: string): Promise<void> {
    if (this.failNextPuts > 0) {
      this.failNextPuts -= 1
      throw new Error('injected putFile failure')
    }
    this.ops.push({ op: 'putFile', key })
    this.objects.set(key, await readFile(localPath))
  }

  getBuffer(key: string): Promise<Buffer> {
    const found = this.objects.get(key)
    if (!found) {
      const err = new Error(`missing key ${key}`)
      err.name = 'NoSuchKey'
      throw err
    }
    return Promise.resolve(Buffer.from(found))
  }

  headObject(key: string): Promise<void> {
    if (!this.objects.has(key)) {
      const err = new Error(`missing key ${key}`)
      err.name = 'NoSuchKey'
      throw err
    }
    return Promise.resolve()
  }

  copyKey(srcKey: string, dstKey: string): Promise<void> {
    if (this.failNextCopies > 0) {
      this.failNextCopies -= 1
      throw new Error('injected copyKey failure')
    }
    const found = this.objects.get(srcKey)
    if (!found) {
      const err = new Error(`missing key ${srcKey}`)
      err.name = 'NoSuchKey'
      throw err
    }
    this.ops.push({ op: 'copyKey', key: dstKey })
    this.objects.set(dstKey, Buffer.from(found))
    return Promise.resolve()
  }

  async copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
    for (const key of await this.listKeys(srcPrefix)) {
      if (key.endsWith('/manifest.json')) continue
      await this.copyKey(key, `${dstPrefix}${key.slice(srcPrefix.length)}`)
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    await writeFile(destPath, await this.getBuffer(key))
  }

  listKeys(prefix: string): Promise<string[]> {
    if (this.failListKeys) return Promise.reject(new Error('injected listKeys failure'))
    return Promise.resolve([...this.objects.keys()].filter((k) => k.startsWith(prefix)))
  }

  deleteKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.ops.push({ op: 'deleteKey', key })
      this.objects.delete(key)
    }
    return Promise.resolve()
  }
}

interface JobData {
  assetId?: string
  kind?: string
  userId?: string
}

describe('user backup round-trip', () => {
  let app: INestApplication
  let dataSource: DataSource
  let storage: LocalStorageService
  let storageDir = ''
  let prevStorageDir: string | undefined
  let svc: UserBackupService
  let bullMq: BullMqService
  let fake: FakeS3BackupService
  let userRepo: Repository<User>
  let fileRepo: Repository<FileRecord>
  let assetRepo: Repository<Asset>
  let albumRepo: Repository<Album>
  let albumAssetRepo: Repository<AlbumAsset>
  let shareRepo: Repository<Share>
  let personRepo: Repository<Person>
  let mergeRepo: Repository<BackupMerge>

  beforeAll(async () => {
    const { pgHost, pgPort, pgDb } = await setupTestInfra()
    storageDir = mkdtempSync(join(tmpdir(), 'backup-int-storage-'))
    prevStorageDir = process.env.STORAGE_DIR
    process.env.STORAGE_DIR = storageDir
    fake = new FakeS3BackupService()
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: 'postgres',
            host: pgHost,
            port: pgPort,
            username: 'photox',
            password: 'photox',
            database: pgDb,
            entities: ENTITIES,
            synchronize: true,
            poolSize: 5,
          }),
          TypeOrmModule.forFeature(ENTITIES),
          BullMqModule,
          BackupModule,
        ],
      })
        .overrideProvider(S3BackupService)
        .useValue(fake)
        .compile()
      app = moduleRef.createNestApplication()
      await app.init()
      dataSource = app.get<DataSource>(DataSource)
      storage = app.get<LocalStorageService>(LocalStorageService)
      svc = app.get<UserBackupService>(UserBackupService)
      bullMq = app.get<BullMqService>(BullMqService)
      userRepo = app.get<Repository<User>>(getRepositoryToken(User))
      fileRepo = app.get<Repository<FileRecord>>(getRepositoryToken(FileRecord))
      assetRepo = app.get<Repository<Asset>>(getRepositoryToken(Asset))
      albumRepo = app.get<Repository<Album>>(getRepositoryToken(Album))
      albumAssetRepo = app.get<Repository<AlbumAsset>>(getRepositoryToken(AlbumAsset))
      shareRepo = app.get<Repository<Share>>(getRepositoryToken(Share))
      personRepo = app.get<Repository<Person>>(getRepositoryToken(Person))
      mergeRepo = app.get<Repository<BackupMerge>>(getRepositoryToken(BackupMerge))
    } catch (err) {
      if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
      else process.env.STORAGE_DIR = prevStorageDir
      throw err
    }
  }, 120_000)

  afterAll(async () => {
    await app.close()
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    await teardownTestInfra()
    rmSync(storageDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE users, files, assets, albums, album_assets, shares, persons, ' +
        'app_settings, backup_merges RESTART IDENTITY CASCADE',
    )
    rmSync(storageDir, { recursive: true, force: true })
    await storage.ensureDir()
    fake.objects.clear()
    fake.ops = []
    fake.failNextPuts = 0
    fake.failNextCopies = 0
    fake.failListKeys = false
  })

  async function seedOriginal(
    userId: string,
    bytes: Buffer,
    opts?: { mimeType?: string; originalName?: string },
  ): Promise<{ record: FileRecord; bytes: Buffer }> {
    const storageKey = `originals/${userId}/${randomUUID()}.bin`
    await mkdir(dirname(storage.pathFor(storageKey)), { recursive: true })
    await writeFile(storage.pathFor(storageKey), bytes)
    const record = await fileRepo.save(
      fileRepo.create({
        userId,
        storageKey,
        originalName: opts?.originalName ?? 'photo.bin',
        mimeType: opts?.mimeType ?? 'image/png',
        sizeBytes: bytes.length,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        purpose: 'original',
        assetId: null,
      }),
    )
    return { record, bytes }
  }

  async function seedFile(
    userId: string,
    storageKey: string,
    bytes: Buffer,
    opts?: { mimeType?: string; originalName?: string; purpose?: 'original' | 'transcode' },
  ): Promise<FileRecord> {
    await mkdir(dirname(storage.pathFor(storageKey)), { recursive: true })
    await writeFile(storage.pathFor(storageKey), bytes)
    return fileRepo.save(
      fileRepo.create({
        userId,
        storageKey,
        originalName: opts?.originalName ?? 'file.bin',
        mimeType: opts?.mimeType ?? 'image/png',
        sizeBytes: bytes.length,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        purpose: opts?.purpose ?? 'original',
        assetId: null,
      }),
    )
  }

  async function wipeUserData(): Promise<void> {
    await dataSource.query(
      'TRUNCATE users, files, assets, albums, album_assets, shares, persons, backup_merges ' +
        'RESTART IDENTITY CASCADE',
    )
    rmSync(storageDir, { recursive: true, force: true })
    await storage.ensureDir()
  }

  function expectManifestLast(): void {
    const manifestIdx = fake.ops.findIndex((o) => o.key.endsWith('manifest.json'))
    expect(manifestIdx).toBeGreaterThan(-1)
    const byteOps = fake.ops.filter((o) => o.op === 'putFile')
    expect(byteOps.length).toBeGreaterThan(0)
    for (const op of byteOps) {
      expect(fake.ops.indexOf(op)).toBeLessThan(manifestIdx)
    }
  }

  async function queueJobsFor(queueName: string, userId: string): Promise<JobData[]> {
    const jobs = await bullMq.getQueue(queueName).getJobs(['waiting', 'delayed', 'active'])
    return jobs.map((j) => j.data as JobData).filter((d) => d.userId === userId)
  }

  it('backs up and restores one user via EMAIL with same UUIDs (M1/M2/M4)', async () => {
    const email = `backup-${randomUUID()}@example.com`
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Backup User',
      }),
    )

    const photo = await seedOriginal(user.id, Buffer.from('backup-photo-bytes'), {
      mimeType: 'image/png',
      originalName: 'photo.png',
    })
    const photoAsset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: photo.record.id,
        isTrashed: false,
        mimeType: 'image/png',
        phash: 'abcdef0123456789',
        metadataStatus: 'ready',
        metadataExtractedAt: new Date(),
        thumbnailStatus: 'ready',
        faceStatus: 'ready',
        embeddingStatus: 'ready',
        faceCount: 1,
        width: 64,
        height: 64,
      }),
    )

    const video = await seedOriginal(user.id, Buffer.from('backup-video-bytes'), {
      mimeType: 'video/mp4',
      originalName: 'clip.mp4',
    })
    const videoAsset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'video',
        fileId: video.record.id,
        isTrashed: false,
        mimeType: 'video/mp4',
        phash: '0123456789abcdef',
        metadataStatus: 'ready',
        metadataExtractedAt: new Date(),
        thumbnailStatus: 'ready',
        transcodeStatus: 'ready',
        transcodeFileId: randomUUID(),
      }),
    )

    const trash = await seedOriginal(user.id, Buffer.from('backup-trash-bytes'))
    const trashedAsset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: trash.record.id,
        isTrashed: true,
        trashedAt: new Date(),
        mimeType: 'image/png',
      }),
    )

    const album = await albumRepo.save(
      albumRepo.create({ userId: user.id, name: 'Trip', description: null }),
    )
    await albumAssetRepo.save(albumAssetRepo.create({ albumId: album.id, assetId: photoAsset.id }))
    const token = createHash('sha256').update(randomUUID()).digest('hex')
    const share = await shareRepo.save(
      shareRepo.create({
        userId: user.id,
        kind: 'asset',
        assetId: photoAsset.id,
        albumId: null,
        token,
        expiresAt: null,
      }),
    )
    const person = await personRepo.save(
      personRepo.create({
        userId: user.id,
        name: 'Mom',
        coverFaceId: randomUUID(),
        clusterLabel: 'c1',
        faceCount: 5,
      }),
    )

    // M1: EMAIL identifier (uppercased) — pre-fix this 500s on the uuid-typed lookup
    const backed = await svc.backupUser(email.toUpperCase())
    expect(backed).toMatchObject({
      userId: user.id,
      files: 3,
      assets: 3,
      albums: 1,
      shares: 1,
      persons: 1,
    })
    expectManifestLast()

    const status = await svc.backupStatus(email.toUpperCase())
    expect(status).toMatchObject({ exists: true, userId: user.id, files: 3 })

    await wipeUserData()

    // M4: RestoreResult records the window cleanup-orphans must stay paused across
    const result = await svc.restoreUser(email.toUpperCase())
    expect(result.userId).toBe(user.id)
    expect(result.email).toBe(email)
    expect(result.restoredFrom.emailAtBackup).toBe(email)
    expect(result.restoredFrom.prefix).toBe(result.prefix)
    expect(result.restoredFrom.manifestObjectKey.endsWith('manifest.json')).toBe(true)
    expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result.startedAt).getTime(),
    )
    // M2: video gets a metadata job too — 2 live assets (trashed excluded)
    expect(result.enqueued).toEqual({ metadata: 2, thumbnails: 8, videos: 1, faces: 1, ai: 3 })

    const restoredUser = await userRepo.findOneOrFail({ where: { id: user.id } })
    expect(restoredUser.email).toBe(email)

    for (const f of [photo, video, trash]) {
      const row = await fileRepo.findOneOrFail({ where: { id: f.record.id } })
      expect(row.storageKey).toBe(f.record.storageKey)
      expect(await readFile(storage.pathFor(row.storageKey))).toEqual(f.bytes)
    }

    for (const id of [photoAsset.id, videoAsset.id]) {
      const row = await assetRepo.findOneOrFail({ where: { id } })
      expect(row.metadataStatus).toBe('pending')
      expect(row.metadataExtractedAt).toBeNull()
      expect(row.phash).toBeNull()
      expect(row.transcodeFileId).toBeNull()
    }
    const trashedAfter = await assetRepo.findOneOrFail({ where: { id: trashedAsset.id } })
    expect(trashedAfter.isTrashed).toBe(true)
    expect(trashedAfter.trashedAt).not.toBeNull()

    await albumRepo.findOneOrFail({ where: { id: album.id } })
    await albumAssetRepo.findOneOrFail({
      where: { albumId: album.id, assetId: photoAsset.id },
    })
    const shareAfter = await shareRepo.findOneOrFail({ where: { id: share.id } })
    expect(shareAfter.token).toBe(token)
    const personAfter = await personRepo.findOneOrFail({ where: { id: person.id } })
    expect(personAfter.coverFaceId).toBeNull()
    // A3: faceCount stays stale until the restore cluster job runs
    expect(personAfter.faceCount).toBe(5)

    const metadataJobs = await queueJobsFor('process-metadata', user.id)
    expect(metadataJobs.map((d) => d.assetId).sort()).toEqual([photoAsset.id, videoAsset.id].sort())
    expect(metadataJobs.find((d) => d.assetId === videoAsset.id)?.kind).toBe('video')

    const videoJobs = await queueJobsFor('process-video', user.id)
    expect(videoJobs.some((d) => d.assetId === videoAsset.id)).toBe(true)
    expect(videoJobs.some((d) => d.assetId === photoAsset.id)).toBe(false)

    const thumbJobs = await queueJobsFor('process-thumbnail', user.id)
    expect(thumbJobs.filter((d) => d.assetId === photoAsset.id)).toHaveLength(4)
    expect(thumbJobs.filter((d) => d.assetId === videoAsset.id)).toHaveLength(4)

    // M1: unknown email is a 404, never a uuid-typed 500 (QueryFailedError 22P02)
    await expect(svc.backupUser('no-such-user@example.com')).rejects.toThrow(NotFoundException)
  })

  // Regression: BullMQ dedups by jobId, so the deterministic restore jobIds of a first
  // restore stay retained (completed records, removeOnComplete unset for most families)
  // and every add of a later restore of the same user was swallowed as `duplicated` —
  // originals came back but no derivative regenerated (places worked: synchronous backfill).
  it('re-enqueues derivatives on a second restore instead of deduping into retained records', async () => {
    const email = `restore-twice-${randomUUID()}@example.com`
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Twice User',
      }),
    )

    const photo = await seedOriginal(user.id, Buffer.from('twice-photo-bytes'), {
      mimeType: 'image/png',
      originalName: 'photo.png',
    })
    const photoAsset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: photo.record.id,
        isTrashed: false,
        mimeType: 'image/png',
        metadataStatus: 'ready',
        thumbnailStatus: 'ready',
        faceStatus: 'ready',
        embeddingStatus: 'ready',
      }),
    )
    const video = await seedOriginal(user.id, Buffer.from('twice-video-bytes'), {
      mimeType: 'video/mp4',
      originalName: 'clip.mp4',
    })
    const videoAsset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'video',
        fileId: video.record.id,
        isTrashed: false,
        mimeType: 'video/mp4',
        metadataStatus: 'ready',
        thumbnailStatus: 'ready',
        transcodeStatus: 'ready',
        transcodeFileId: randomUUID(),
      }),
    )

    await svc.backupUser(email)
    await wipeUserData()

    // no media workers run in this app: boot trivial ones so the first restore's jobs
    // reach `completed` and their records are retained — exactly what the worker-service
    // leaves behind. Closed in `finally` so they never consume later specs' jobs.
    const runnableQueues = [
      'process-thumbnail',
      'process-video',
      'process-metadata',
      'process-faces',
      'process-embeddings',
      'process-ocr',
      'process-detect',
    ] as const
    const env = loadEnv()
    const workers = runnableQueues.map(
      (name) =>
        new Worker(name, () => Promise.resolve(undefined), {
          connection: {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            password: env.REDIS_PASSWORD,
            db: env.REDIS_DB,
            maxRetriesPerRequest: null,
          },
        }),
    )
    try {
      await svc.restoreUser(email)
      for (const name of runnableQueues) {
        let runnable = 1
        for (let i = 0; i < 300 && runnable > 0; i++) {
          runnable = (await queueJobsFor(name, user.id)).length
          if (runnable > 0) await new Promise((r) => setTimeout(r, 100))
        }
        expect(runnable, `${name} still had runnable jobs`).toBe(0)
      }
    } finally {
      await Promise.all(workers.map((w) => w.close()))
    }

    // the delete path drains pending media jobs only — the completed records stay put,
    // so the second restore enqueues into ids that already exist
    await wipeUserData()

    const second = await svc.restoreUser(email)
    expect(second.enqueued).toEqual({ metadata: 2, thumbnails: 8, videos: 1, faces: 1, ai: 3 })

    // every family must be runnable again: pre-fix each of these adds was rejected as
    // `duplicated` against the retained record and nothing regenerated
    const thumbs = await queueJobsFor('process-thumbnail', user.id)
    expect(thumbs.filter((d) => d.assetId === photoAsset.id)).toHaveLength(4)
    expect(thumbs.filter((d) => d.assetId === videoAsset.id)).toHaveLength(4)
    const faces = await queueJobsFor('process-faces', user.id)
    expect(faces.filter((d) => d.assetId === photoAsset.id)).toHaveLength(1)
    const videos = await queueJobsFor('process-video', user.id)
    expect(videos.filter((d) => d.assetId === videoAsset.id)).toHaveLength(1)
    const embeds = await queueJobsFor('process-embeddings', user.id)
    expect(embeds.some((d) => d.assetId === photoAsset.id)).toBe(true)
    const ocr = await queueJobsFor('process-ocr', user.id)
    expect(ocr.some((d) => d.assetId === photoAsset.id)).toBe(true)
    const detects = await queueJobsFor('process-detect', user.id)
    expect(detects.some((d) => d.assetId === photoAsset.id)).toBe(true)
  }, 120_000)

  it('reruns after a mid-run failure with bytes first and manifest last (M3)', async () => {
    const email = `rerun-${randomUUID()}@example.com`
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Rerun User',
      }),
    )
    const a = await seedOriginal(user.id, Buffer.from('rerun-a-bytes'))
    const b = await seedOriginal(user.id, Buffer.from('rerun-b-bytes'))
    await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: a.record.id,
        isTrashed: false,
      }),
    )
    await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: b.record.id,
        isTrashed: false,
      }),
    )

    fake.failNextPuts = 1
    await expect(svc.backupUser(user.id)).rejects.toThrow('injected putFile failure')
    // manifest-last: the failed run leaves no live manifest over missing bytes
    expect([...fake.objects.keys()].some((k) => k.endsWith('manifest.json'))).toBe(false)

    fake.ops = []
    fake.failNextPuts = 0
    const backed = await svc.backupUser(user.id)
    expect(backed.files).toBe(2)
    expectManifestLast()

    await wipeUserData()
    const restored = await svc.restoreUser(email)
    expect(restored.files).toBe(2)
    for (const f of [a, b]) {
      const row = await fileRepo.findOneOrFail({ where: { id: f.record.id } })
      expect(await readFile(storage.pathFor(row.storageKey))).toEqual(f.bytes)
    }
  })

  it('backs up original bytes only, skipping thumbnail/transcode derivatives', async () => {
    const email = `derivatives-${randomUUID()}@example.com`
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Derivatives User',
      }),
    )
    const original = await seedOriginal(user.id, Buffer.from('derivative-test-original'))
    const thumbBytes = Buffer.from('derivative-test-thumb')
    await seedFile(user.id, `derivatives/thumbnails/${user.id}/${randomUUID()}.webp`, thumbBytes, {
      mimeType: 'image/webp',
      originalName: 'thumb-sm.webp',
      purpose: 'original',
    })
    const transcodeBytes = Buffer.from('derivative-test-transcode')
    await seedFile(
      user.id,
      `derivatives/transcodes/${user.id}/${randomUUID()}.mp4`,
      transcodeBytes,
      { mimeType: 'video/mp4', originalName: 'clip-transcode.mp4', purpose: 'transcode' },
    )
    const legacyBytes = Buffer.from('derivative-test-legacy-transcode')
    await seedFile(user.id, `derivatives/transcodes/${user.id}/${randomUUID()}.mp4`, legacyBytes, {
      mimeType: 'video/mp4',
      originalName: 'legacy-transcode.mp4',
      purpose: 'original',
    })

    // pre-fix rerun leaves stale thumbnail bytes under originals/ — prune must delete them
    const staleKey = `${backupPrefix(email, user.id)}originals/${randomUUID()}.webp`
    fake.objects.set(staleKey, Buffer.from('stale-thumb-bytes'))

    const backed = await svc.backupUser(user.id)
    expect(backed.files).toBe(1)
    const putFiles = fake.ops.filter((o) => o.op === 'putFile')
    expect(putFiles).toHaveLength(1)
    const manifestObjectKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key
    const manifest = JSON.parse((await fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      files: { id: string; storageKey: string }[]
    }
    expect(manifest.files).toHaveLength(1)
    expect(manifest.files[0]!.id).toBe(original.record.id)
    expect(manifest.files[0]!.storageKey.startsWith('originals/')).toBe(true)
    expectManifestLast()
    // stale pre-fix bytes are pruned before the manifest lands, expected original remains
    expect(fake.objects.has(staleKey)).toBe(false)
    expect(fake.objects.has(putFiles[0]!.key)).toBe(true)
    const deletes = fake.ops.filter((o) => o.op === 'deleteKey')
    expect(deletes.map((o) => o.key)).toContain(staleKey)
    const manifestIdx = fake.ops.findIndex((o) => o.key.endsWith('manifest.json'))
    for (const op of deletes) {
      expect(fake.ops.indexOf(op)).toBeLessThan(manifestIdx)
    }

    const status = await svc.backupStatus(user.id)
    expect(status).toMatchObject({ exists: true, userId: user.id, files: 1 })
  })

  it('reports original-only status and skips derivatives on restore for legacy manifests', async () => {
    const email = `legacy-${randomUUID()}@example.com`
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Legacy User',
      }),
    )
    const original = await seedOriginal(user.id, Buffer.from('legacy-original-bytes'))
    const thumbBytes = Buffer.from('legacy-thumb-bytes')
    const thumb = await seedFile(
      user.id,
      `derivatives/thumbnails/${user.id}/${randomUUID()}.webp`,
      thumbBytes,
      { mimeType: 'image/webp', originalName: 'thumb-sm.webp', purpose: 'original' },
    )

    const backed = await svc.backupUser(user.id)
    expect(backed.files).toBe(1)

    // splice a pre-fix derivative entry into the stored manifest plus its S3 bytes
    const manifestObjectKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key
    const stored = JSON.parse((await fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      files: {
        id: string
        userId: string
        storageKey: string
        originalName: string
        mimeType: string
        sizeBytes: number
        checksumSha256: string
        purpose: 'original'
        assetId: string | null
      }[]
    }
    stored.files.push({
      id: thumb.id,
      userId: thumb.userId,
      storageKey: thumb.storageKey,
      originalName: thumb.originalName,
      mimeType: thumb.mimeType,
      sizeBytes: thumbBytes.length,
      checksumSha256: thumb.checksumSha256,
      purpose: 'original',
      assetId: null,
    })
    await fake.putObject(manifestObjectKey, Buffer.from(JSON.stringify(stored)))
    const prefix = manifestObjectKey.slice(0, -'manifest.json'.length)
    await fake.putFile(`${prefix}originals/${thumb.id}.webp`, storage.pathFor(thumb.storageKey))

    // status reports original-only despite the legacy derivative entry
    expect((await svc.backupStatus(user.id)).files).toBe(1)

    await wipeUserData()

    const restored = await svc.restoreUser(email)
    expect(restored.files).toBe(1)
    const restoredOriginal = await fileRepo.findOneOrFail({ where: { id: original.record.id } })
    expect(await readFile(storage.pathFor(restoredOriginal.storageKey))).toEqual(original.bytes)
    expect(await fileRepo.findOne({ where: { id: thumb.id } })).toBeNull()
    expect(await storage.exists(thumb.storageKey)).toBe(false)
    expect((await svc.backupStatus(email)).files).toBe(1)
  })

  it('backupStatus is false for unknown users and missing manifests (A4)', async () => {
    await expect(svc.backupStatus(`ghost-${randomUUID()}@example.com`)).resolves.toEqual({
      exists: false,
    })

    const email = `status-${randomUUID()}@example.com`
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Status User',
      }),
    )
    await seedOriginal(user.id, Buffer.from('status-bytes'))
    await svc.backupUser(user.id)
    expect((await svc.backupStatus(email)).exists).toBe(true)

    for (const key of [...fake.objects.keys()]) {
      if (key.endsWith('manifest.json')) fake.objects.delete(key)
    }
    // isNotFound covers NoSuchKey/NotFound/NoSuchBucket, not one name
    await expect(svc.backupStatus(email)).resolves.toEqual({ exists: false })
  })

  describe('incremental gate + lazy rename', () => {
    async function seedUserWithFiles(
      count: number,
      prefixLabel: string,
    ): Promise<{ user: User; seeded: { record: FileRecord; bytes: Buffer }[] }> {
      const email = `${prefixLabel}-${randomUUID()}@example.com`
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: `${prefixLabel} User`,
        }),
      )
      const seeded = []
      for (let i = 0; i < count; i++) {
        seeded.push(await seedOriginal(user.id, Buffer.from(`${prefixLabel}-bytes-${i}`)))
      }
      return { user, seeded }
    }

    it('skips all uploads on an unchanged rerun (uploaded 0, empty prune)', async () => {
      const { user } = await seedUserWithFiles(2, 'skipall')
      const first = await svc.backupUser(user.id)
      expect(first.uploaded).toBe(2)
      expect(first.skipped).toBe(0)

      fake.ops = []
      const second = await svc.backupUser(user.id)
      expect(second).toMatchObject({ files: 2, uploaded: 0, skipped: 2 })
      expect(fake.ops.filter((o) => o.op === 'putFile')).toHaveLength(0)
      expect(fake.ops.filter((o) => o.op === 'putObject')).toHaveLength(1)
      // empty prune: no deletes when nothing is stale
      expect(fake.ops.filter((o) => o.op === 'deleteKey')).toHaveLength(0)
    })

    it('uploads only new files on the next run (delta-only)', async () => {
      const { user } = await seedUserWithFiles(2, 'delta')
      await svc.backupUser(user.id)

      await seedOriginal(user.id, Buffer.from('delta-new-bytes'))
      fake.ops = []
      const second = await svc.backupUser(user.id)
      expect(second).toMatchObject({ files: 3, uploaded: 1, skipped: 2 })
      expect(fake.ops.filter((o) => o.op === 'putFile')).toHaveLength(1)
    })

    it('re-uploads when the checksum changes', async () => {
      const { user, seeded } = await seedUserWithFiles(2, 'checksum')
      await svc.backupUser(user.id)

      const target = seeded[0]!.record
      const nextBytes = Buffer.from('checksum-changed-bytes')
      await writeFile(storage.pathFor(target.storageKey), nextBytes)
      await fileRepo.update(target.id, {
        sizeBytes: nextBytes.length,
        checksumSha256: createHash('sha256').update(nextBytes).digest('hex'),
      })
      fake.ops = []
      const second = await svc.backupUser(user.id)
      expect(second).toMatchObject({ files: 2, uploaded: 1, skipped: 1 })
      const putKeys = fake.ops.filter((o) => o.op === 'putFile').map((o) => o.key)
      expect(putKeys).toHaveLength(1)
      expect(putKeys[0]).toContain(target.id)
    })

    it('falls back to a full upload on a missing manifest', async () => {
      const { user } = await seedUserWithFiles(2, 'missing-manifest')
      await svc.backupUser(user.id)

      for (const key of [...fake.objects.keys()]) {
        if (key.endsWith('manifest.json')) fake.objects.delete(key)
      }
      fake.ops = []
      const second = await svc.backupUser(user.id)
      expect(second).toMatchObject({ files: 2, uploaded: 2, skipped: 0 })
    })

    it('falls back to a full upload on a corrupt manifest', async () => {
      const { user } = await seedUserWithFiles(2, 'corrupt-manifest')
      await svc.backupUser(user.id)

      const manifestKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key
      fake.objects.set(manifestKey, Buffer.from('not-json{{{'))
      fake.ops = []
      const second = await svc.backupUser(user.id)
      expect(second).toMatchObject({ files: 2, uploaded: 2, skipped: 0 })
    })

    it('re-uploads S3-missing keys despite a manifest match', async () => {
      const { user } = await seedUserWithFiles(2, 's3missing')
      await svc.backupUser(user.id)

      const originalKeys = [...fake.objects.keys()].filter((k) => k.includes('/originals/'))
      expect(originalKeys).toHaveLength(2)
      fake.objects.delete(originalKeys[0]!)
      fake.ops = []
      const second = await svc.backupUser(user.id)
      expect(second).toMatchObject({ files: 2, uploaded: 1, skipped: 1 })
      expect(fake.ops.filter((o) => o.op === 'putFile').map((o) => o.key)).toEqual([
        originalKeys[0],
      ])
    })

    it('uploads all and skips prune when listKeys fails', async () => {
      const { user } = await seedUserWithFiles(1, 'listfail')
      await svc.backupUser(user.id)
      // second run would skip, but listing fails so every byte re-uploads
      fake.failListKeys = true
      // stale key that prune would delete if listing worked
      const staleKey = `${backupPrefix((await userRepo.findOneOrFail({ where: { id: user.id } })).email, user.id)}originals/stale.webp`
      fake.objects.set(staleKey, Buffer.from('stale'))
      fake.ops = []
      const second = await svc.backupUser(user.id)
      expect(second).toMatchObject({ files: 1, uploaded: 1, skipped: 0 })
      expect(fake.ops.filter((o) => o.op === 'deleteKey')).toHaveLength(0)
      expect(fake.objects.has(staleKey)).toBe(true)
      fake.failListKeys = false
    })

    it('auto-renames on email change with ~0 uploads and copy→manifest→delete order', async () => {
      const { user, seeded } = await seedUserWithFiles(2, 'rename')
      const oldEmail = user.email
      const oldPrefix = backupPrefix(oldEmail, user.id)
      await svc.backupUser(user.id)
      expect([...fake.objects.keys()].some((k) => k.startsWith(oldPrefix))).toBe(true)

      const newEmail = `renamed-${randomUUID()}@example.com`
      await userRepo.update(user.id, { email: newEmail })
      const newPrefix = backupPrefix(newEmail, user.id)
      fake.ops = []

      const second = await svc.backupUser(user.id)
      expect(second.prefix).toBe(newPrefix)
      expect(second.uploaded).toBeLessThanOrEqual(1)
      expect(second.skipped).toBeGreaterThanOrEqual(1)
      expect(second.files).toBe(2)

      // old prefix gone, new prefix holds the bytes + fresh manifest
      expect([...fake.objects.keys()].some((k) => k.startsWith(oldPrefix))).toBe(false)
      expect([...fake.objects.keys()].filter((k) => k.startsWith(newPrefix))).toHaveLength(3)
      for (const f of seeded) {
        const expectedSuffix = `/originals/${f.record.id}.`
        expect(
          [...fake.objects.keys()].some(
            (k) => k.startsWith(newPrefix) && k.includes(expectedSuffix),
          ),
        ).toBe(true)
      }

      // call order: copy-forward first, manifest next, old-prefix deletes last
      const copyIdx = fake.ops.findIndex((o) => o.op === 'copyKey')
      const manifestIdx = fake.ops.findIndex(
        (o) => o.op === 'putObject' && o.key.endsWith('manifest.json'),
      )
      const deleteIdx = fake.ops.findIndex((o) => o.op === 'deleteKey')
      expect(copyIdx).toBeGreaterThanOrEqual(0)
      expect(manifestIdx).toBeGreaterThan(copyIdx)
      expect(deleteIdx).toBeGreaterThan(manifestIdx)
      // empty prune: every delete targets the old prefix, none prunes the new one
      for (const op of fake.ops.filter((o) => o.op === 'deleteKey')) {
        expect(op.key.startsWith(oldPrefix)).toBe(true)
      }
    })
  })

  describe('backupOverview orphans (Phase 1)', () => {
    async function backupOneFile(
      email: string,
    ): Promise<{ user: User; prefix: string; manifestKey: string }> {
      const u = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Overview User',
        }),
      )
      await seedOriginal(u.id, Buffer.from(`overview-bytes-${email}`))
      const res = await svc.backupUser(u.id)
      const manifestKey = `${res.prefix}manifest.json`
      return { user: u, prefix: res.prefix, manifestKey }
    }

    async function deleteUserRowsKeepS3(userId: string): Promise<void> {
      await shareRepo.delete({ userId })
      await personRepo.delete({ userId })
      await assetRepo.delete({ userId })
      await fileRepo.delete({ userId })
      await albumRepo.delete({ userId })
      await userRepo.delete(userId)
    }

    it('unions live + orphan rows with deleted flags sorted by email', async () => {
      const liveEmail = `live-${randomUUID()}@example.com`
      const live = await backupOneFile(liveEmail)
      const orphanEmail = `orphan-${randomUUID()}@example.com`
      const orphan = await backupOneFile(orphanEmail)
      await deleteUserRowsKeepS3(orphan.user.id)

      const rows = await svc.backupOverview()
      const byId = new Map(rows.map((r) => [r.userId, r]))
      const liveRow = byId.get(live.user.id)!
      expect(liveRow).toMatchObject({ email: liveEmail, deleted: false, exists: true })
      expect(liveRow.totalAssets).toBe(0)
      const orphanRow = byId.get(orphan.user.id)!
      expect(orphanRow).toMatchObject({
        email: orphanEmail,
        deleted: true,
        exists: true,
        totalAssets: 0,
        notBackedUp: 0,
      })
      expect(orphanRow.backedUpFiles).toBe(1)
      expect(orphanRow.emailAtBackup).toBeUndefined()
      const emails = rows.map((r) => r.email)
      expect([...emails].sort()).toEqual(emails)
    })

    it('passes through corrupt/unreadable orphans and skips manifest-less prefixes', async () => {
      const corruptEmail = `corrupt-${randomUUID()}@example.com`
      const corrupt = await backupOneFile(corruptEmail)
      fake.objects.set(corrupt.manifestKey, Buffer.from('not-json{{{'))
      await deleteUserRowsKeepS3(corrupt.user.id)

      const unreadEmail = `unread-${randomUUID()}@example.com`
      const unread = await backupOneFile(unreadEmail)
      await deleteUserRowsKeepS3(unread.user.id)
      const unreadKey = unread.manifestKey
      const origGet = fake.getBuffer.bind(fake)
      fake.getBuffer = (key: string) => {
        if (key === unreadKey) {
          const err = new Error('injected unreadable')
          err.name = 'InternalError'
          throw err
        }
        return origGet(key)
      }

      const bareId = randomUUID()
      const barePrefix = backupPrefix(`bare-${randomUUID()}@example.com`, bareId)
      fake.objects.set(`${barePrefix}originals/stray.bin`, Buffer.from('stray'))

      try {
        const rows = await svc.backupOverview()
        const byId = new Map(rows.map((r) => [r.userId, r]))
        expect(byId.get(corrupt.user.id)).toMatchObject({
          deleted: true,
          exists: true,
          degraded: 'corrupt',
        })
        expect(byId.get(unread.user.id)).toMatchObject({
          deleted: true,
          exists: true,
          degraded: 'unreadable',
        })
        expect(byId.has(bareId)).toBe(false)
      } finally {
        fake.getBuffer = origGet
      }
    })
  })

  describe('restore collisions (Phase 1)', () => {
    async function backupSingle(email: string): Promise<{ user: User; prefix: string }> {
      const u = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Collision User',
        }),
      )
      await seedOriginal(u.id, Buffer.from(`collision-bytes-${email}`))
      const res = await svc.backupUser(u.id)
      return { user: u, prefix: res.prefix }
    }

    it('throws 409 already-restored when the same userId is live', async () => {
      const email = `sameid-${randomUUID()}@example.com`
      const { user } = await backupSingle(email)
      const caught = await svc.restoreUser(user.id).catch((e: unknown) => e)
      expect(caught).toBeInstanceOf(ConflictException)
      expect((caught as ConflictException).getStatus()).toBe(409)
      expect((caught as ConflictException).message).toContain('already-restored')
    })

    it('restores a gone user under the original id and email', async () => {
      const email = `gone-${randomUUID()}@example.com`
      const { user, prefix } = await backupSingle(email)
      await dataSource.query(
        'TRUNCATE users, files, assets, albums, album_assets, shares, persons ' +
          'RESTART IDENTITY CASCADE',
      )
      rmSync(storageDir, { recursive: true, force: true })
      await storage.ensureDir()
      const result = await svc.restoreUser(user.id)
      expect(result.userId).toBe(user.id)
      expect(result.email).toBe(email)
      expect(result.prefix).toBe(prefix)
      expect(result.reassignmentError).toBeUndefined()
      expect(result.restoredFrom).toMatchObject({ emailAtBackup: email, prefix })
      expect(result.restoredFrom.manifestObjectKey.endsWith('manifest.json')).toBe(true)
      // same email: no re-home — the source prefix keeps its bytes + manifest
      const keptKeys = await fake.listKeys(prefix)
      expect(keptKeys.some((k) => k.endsWith('manifest.json'))).toBe(true)
      expect(keptKeys.length).toBe(2)
      const row = await userRepo.findOneOrFail({ where: { id: user.id } })
      expect(row.email).toBe(email)
    })

    it('falls back to restored-<ms>-<orig> when the email is taken by another id', async () => {
      const origEmail = `reuse-${randomUUID()}@example.com`
      const { user: orig, prefix } = await backupSingle(origEmail)
      const origId = orig.id
      await shareRepo.delete({ userId: origId })
      await personRepo.delete({ userId: origId })
      await assetRepo.delete({ userId: origId })
      await fileRepo.delete({ userId: origId })
      await userRepo.delete(origId)

      const other = await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Email Reuse',
        }),
      )
      expect(other.id).not.toBe(origId)

      const result = await svc.restoreUser(origId)
      expect(result.userId).toBe(origId)
      expect(result.email).not.toBe(origEmail)
      expect(result.email).toMatch(/^restored-\d+-.*@example\.com$/)
      expect(result.email).toContain(origEmail.split('@')[0]!.toLowerCase())
      // the snapshot is re-homed to the fallback address, restoredFrom keeps the source
      const restoredPrefix = backupPrefix(result.email, origId)
      expect(result.prefix).toBe(restoredPrefix)
      expect(result.reassignmentError).toBeUndefined()
      expect(result.restoredFrom.emailAtBackup).toBe(origEmail)
      expect(result.restoredFrom.prefix).toBe(prefix)

      const restored = await userRepo.findOneOrFail({ where: { id: origId } })
      expect(restored.email).toBe(result.email)
      const holder = await userRepo.findOneOrFail({ where: { id: other.id } })
      expect(holder.email).toBe(origEmail)

      // old prefix fully swept, new prefix carries the manifest + original bytes
      await expect(fake.listKeys(prefix)).resolves.toEqual([])
      const file = await fileRepo.findOneOrFail({ where: { userId: origId } })
      const newKeys = await fake.listKeys(restoredPrefix)
      expect(newKeys).toEqual(
        expect.arrayContaining([
          manifestKey(result.email, origId),
          originalKey(result.email, origId, file.id, 'bin'),
        ]),
      )
      const rehomed = JSON.parse(
        (await fake.getBuffer(manifestKey(result.email, origId))).toString('utf-8'),
      ) as { userId: string; emailAtBackup: string; user: { id: string; email: string } }
      expect(rehomed.emailAtBackup).toBe(result.email)
      expect(rehomed.user.email).toBe(result.email)
      expect(rehomed.userId).toBe(origId)
      expect(rehomed.user.id).toBe(origId)

      await expect(svc.backupStatus(origId)).resolves.toMatchObject({
        exists: true,
        userId: origId,
        emailAtBackup: result.email,
      })
    })

    it('uses an explicit restoreEmail instead of the manifest/fallback allocation', async () => {
      const origEmail = `explicit-${randomUUID()}@example.com`
      const { user: orig, prefix } = await backupSingle(origEmail)
      const origId = orig.id
      await fileRepo.delete({ userId: origId })
      await userRepo.delete(origId)
      // manifest email reused by another live account: the default path would
      // allocate restored-<ms>-<orig>, but the explicit address must win instead
      const other = await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Email Reuse',
        }),
      )

      const requested = `requested-${randomUUID()}@example.com`
      const result = await svc.restoreUser(origId, requested.toUpperCase())
      expect(result.userId).toBe(origId)
      expect(result.email).toBe(requested)
      // the snapshot was re-homed to the requested address; restoredFrom keeps the source
      const restoredPrefix = backupPrefix(requested, origId)
      expect(result.prefix).toBe(restoredPrefix)
      expect(result.reassignmentError).toBeUndefined()
      expect(result.restoredFrom).toMatchObject({ emailAtBackup: origEmail, prefix })
      const restored = await userRepo.findOneOrFail({ where: { id: origId } })
      expect(restored.email).toBe(requested)
      const holder = await userRepo.findOneOrFail({ where: { id: other.id } })
      expect(holder.email).toBe(origEmail)

      await expect(fake.listKeys(prefix)).resolves.toEqual([])
      const file = await fileRepo.findOneOrFail({ where: { userId: origId } })
      const rehomed = JSON.parse(
        (await fake.getBuffer(manifestKey(requested, origId))).toString('utf-8'),
      ) as { userId: string; emailAtBackup: string; user: { id: string; email: string } }
      expect(rehomed.emailAtBackup).toBe(requested)
      expect(rehomed.user.email).toBe(requested)
      expect(rehomed.userId).toBe(origId)
      expect(rehomed.user.id).toBe(origId)
      expect(fake.objects.has(originalKey(requested, origId, file.id, 'bin'))).toBe(true)
    })

    it('keeps the source prefix and reports reassignmentError when re-home fails', async () => {
      const origEmail = `rehome-fail-${randomUUID()}@example.com`
      const { user: orig, prefix } = await backupSingle(origEmail)
      const origId = orig.id
      await shareRepo.delete({ userId: origId })
      await personRepo.delete({ userId: origId })
      await assetRepo.delete({ userId: origId })
      await fileRepo.delete({ userId: origId })
      await userRepo.delete(origId)

      await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Email Reuse',
        }),
      )

      fake.failNextCopies = 1
      const result = await svc.restoreUser(origId)
      // the restore itself still succeeded under the fallback email
      expect(result.userId).toBe(origId)
      expect(result.email).toMatch(/^restored-\d+-.*@example\.com$/)
      expect(result.reassignmentError).toBe('injected copyKey failure')
      expect(result.prefix).toBe(prefix)
      expect(result.restoredFrom.prefix).toBe(prefix)
      const restored = await userRepo.findOneOrFail({ where: { id: origId } })
      expect(restored.email).toBe(result.email)
      // source prefix intact (bytes + manifest), nothing written under the fallback prefix
      const keptKeys = await fake.listKeys(prefix)
      expect(keptKeys.some((k) => k.endsWith('manifest.json'))).toBe(true)
      expect(keptKeys.length).toBe(2)
      await expect(fake.listKeys(backupPrefix(result.email, origId))).resolves.toEqual([])
    })

    it('rejects an explicit restoreEmail owned by another live user (409 email-taken)', async () => {
      const origEmail = `taken-${randomUUID()}@example.com`
      const { user: orig } = await backupSingle(origEmail)
      const origId = orig.id
      await fileRepo.delete({ userId: origId })
      await userRepo.delete(origId)

      const holderEmail = `holder-${randomUUID()}@example.com`
      const holder = await userRepo.save(
        userRepo.create({
          email: holderEmail,
          role: 'user',
          passwordHash: 'holder-hash',
          displayName: 'Holder',
        }),
      )

      const caught = await svc
        .restoreUser(origId, holderEmail.toUpperCase())
        .catch((e: unknown) => e)
      expect(caught).toBeInstanceOf(ConflictException)
      expect((caught as ConflictException).getStatus()).toBe(409)
      expect((caught as ConflictException).message).toContain('email-taken')
      // restores nothing: no row/files for the backup user, holder unchanged
      expect(await userRepo.findOne({ where: { id: origId } })).toBeNull()
      expect(await fileRepo.findOne({ where: { userId: origId } })).toBeNull()
      const stillHolding = await userRepo.findOneOrFail({ where: { id: holder.id } })
      expect(stillHolding.email).toBe(holderEmail)
      await expect(svc.backupStatus(origEmail)).resolves.toMatchObject({ exists: true })
    })

    it('retries the fallback with a suffix when the first candidate is taken', async () => {
      const origEmail = `retry-${randomUUID()}@example.com`
      const { user: orig } = await backupSingle(origEmail)
      const origId = orig.id
      await assetRepo.delete({ userId: origId })
      await fileRepo.delete({ userId: origId })
      await userRepo.delete(origId)
      await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Reuse Holder',
        }),
      )

      const fixedNow = 1720000000000
      const firstCandidate = buildFallbackEmail(origEmail, fixedNow, 0)
      await userRepo.save(
        userRepo.create({
          email: firstCandidate,
          role: 'user',
          passwordHash: 'blocker-hash',
          displayName: 'Fallback Blocker',
        }),
      )
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      try {
        const result = await svc.restoreUser(origId)
        expect(result.email).toBe(buildFallbackEmail(origEmail, fixedNow, 1))
      } finally {
        nowSpy.mockRestore()
      }
    })

    it('double restore throws 409 already-restored', async () => {
      const email = `double-${randomUUID()}@example.com`
      const { user } = await backupSingle(email)
      const origId = user.id
      await dataSource.query(
        'TRUNCATE users, files, assets, albums, album_assets, shares, persons ' +
          'RESTART IDENTITY CASCADE',
      )
      rmSync(storageDir, { recursive: true, force: true })
      await storage.ensureDir()
      const first = await svc.restoreUser(origId)
      expect(first.userId).toBe(origId)
      const caught = await svc.restoreUser(origId).catch((e: unknown) => e)
      expect(caught).toBeInstanceOf(ConflictException)
      expect((caught as ConflictException).message).toContain('already-restored')
    })
  })

  describe('deleteBackup', () => {
    async function backupSingleFile(
      email: string,
    ): Promise<{ user: User; prefix: string; fileId: string; assetId: string }> {
      const u = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Delete User',
        }),
      )
      const seeded = await seedOriginal(u.id, Buffer.from(`delete-bytes-${email}`))
      const asset = await assetRepo.save(
        assetRepo.create({
          userId: u.id,
          kind: 'photo',
          fileId: seeded.record.id,
          isTrashed: false,
        }),
      )
      const res = await svc.backupUser(u.id)
      expect(res.files).toBe(1)
      return { user: u, prefix: res.prefix, fileId: seeded.record.id, assetId: asset.id }
    }

    it('deletes a live user backup without touching DB rows, then re-backup works', async () => {
      const email = `delete-live-${randomUUID()}@example.com`
      const { user, prefix, fileId, assetId } = await backupSingleFile(email)

      const deleted = await svc.deleteBackup(email)
      expect(deleted).toEqual({ userId: user.id, email, prefix, deletedObjects: 2 })

      // overview + status read exists:false while the rows stay live
      await expect(svc.backupStatus(email)).resolves.toEqual({ exists: false })
      const rows = await svc.backupOverview()
      expect(rows.find((r) => r.userId === user.id)).toMatchObject({
        email,
        deleted: false,
        exists: false,
      })
      await userRepo.findOneOrFail({ where: { id: user.id } })
      await fileRepo.findOneOrFail({ where: { id: fileId } })
      await assetRepo.findOneOrFail({ where: { id: assetId } })

      // next backup recreates the prefix from scratch
      const re = await svc.backupUser(user.id)
      expect(re).toMatchObject({ userId: user.id, prefix, files: 1 })
      await expect(svc.backupStatus(email)).resolves.toMatchObject({ exists: true, files: 1 })
    })

    it('deletes an orphan backup by userId and drops it from the overview', async () => {
      const email = `delete-orphan-${randomUUID()}@example.com`
      const { user, prefix } = await backupSingleFile(email)
      await shareRepo.delete({ userId: user.id })
      await personRepo.delete({ userId: user.id })
      await assetRepo.delete({ userId: user.id })
      await fileRepo.delete({ userId: user.id })
      await albumRepo.delete({ userId: user.id })
      await userRepo.delete(user.id)

      const deleted = await svc.deleteBackup(user.id)
      expect(deleted).toEqual({ userId: user.id, email, prefix, deletedObjects: 2 })
      await expect(fake.listKeys(prefix)).resolves.toEqual([])
      expect([...fake.objects.keys()].some((k) => k.startsWith(prefix))).toBe(false)

      const rows = await svc.backupOverview()
      expect(rows.some((r) => r.userId === user.id)).toBe(false)
      await expect(svc.backupStatus(email)).resolves.toEqual({ exists: false })
    })

    it('throws 404 for unknown ids and emails', async () => {
      await expect(svc.deleteBackup(randomUUID())).rejects.toThrow(NotFoundException)
      await expect(svc.deleteBackup(`ghost-${randomUUID()}@example.com`)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('merge backups', () => {
    async function deleteAccountRows(userId: string): Promise<void> {
      const albums = await albumRepo.find({ where: { userId } })
      if (albums.length > 0) {
        await albumAssetRepo.delete({ albumId: In(albums.map((album) => album.id)) })
      }
      await shareRepo.delete({ userId })
      await personRepo.delete({ userId })
      await assetRepo.delete({ userId })
      await fileRepo.delete({ userId })
      await albumRepo.delete({ userId })
      await userRepo.delete(userId)
    }

    async function seedAccount(email: string): Promise<{
      user: User
      file: FileRecord
      bytes: Buffer
      asset: Asset
      album: Album
      share: Share
      person: Person
    }> {
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'legacy-hash',
          displayName: 'Legacy User',
        }),
      )
      const seeded = await seedOriginal(user.id, Buffer.from(`merge-bytes-${email}`), {
        mimeType: 'image/png',
        originalName: 'merge.png',
      })
      const asset = await assetRepo.save(
        assetRepo.create({
          userId: user.id,
          kind: 'photo',
          fileId: seeded.record.id,
          isTrashed: false,
          mimeType: 'image/png',
          width: 64,
          height: 64,
          favorite: true,
          faceCount: 2,
          metadataStatus: 'ready',
          thumbnailStatus: 'ready',
          faceStatus: 'ready',
          embeddingStatus: 'ready',
        }),
      )
      const album = await albumRepo.save(
        albumRepo.create({ userId: user.id, name: 'Legacy Trip', description: 'old album' }),
      )
      await albumAssetRepo.save(albumAssetRepo.create({ albumId: album.id, assetId: asset.id }))
      const share = await shareRepo.save(
        shareRepo.create({
          userId: user.id,
          kind: 'asset',
          assetId: asset.id,
          albumId: null,
          token: createHash('sha256').update(randomUUID()).digest('hex'),
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        }),
      )
      const person = await personRepo.save(
        personRepo.create({
          userId: user.id,
          name: 'Mom',
          coverFaceId: randomUUID(),
          clusterLabel: 'c1',
          faceCount: 5,
        }),
      )
      return { user, file: seeded.record, bytes: seeded.bytes, asset, album, share, person }
    }

    it('merges a matched legacy snapshot, adopts it into the live prefix and removes the source', async () => {
      const email = `merge-${randomUUID()}@example.com`
      const legacy = await seedAccount(email)
      const legacyBackup = await svc.backupUser(legacy.user.id)
      const legacyPrefix = legacyBackup.prefix
      const legacyId = legacy.user.id
      await deleteAccountRows(legacyId)

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target Profile',
        }),
      )
      const result = await svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: legacyId,
      })
      expect(result).toMatchObject({
        targetUserId: target.id,
        targetEmail: email,
        backupUserId: legacyId,
        emailAtBackup: email,
        // the top-level prefix stays the SOURCE prefix for audit; adoption
        // reports the live prefix it moved the snapshot to
        prefix: legacyPrefix,
        merged: { files: 1, assets: 1, albums: 1, albumAssets: 1, shares: 1, persons: 1 },
        deduped: { files: 0, assets: 0 },
      })
      expect(result.adoptionError).toBeUndefined()
      expect(result.assigned).toMatchObject({
        prefix: backupPrefix(email, target.id),
        copiedObjects: 1,
        reusedObjects: 0,
        unionedWithExisting: false,
        sourceDeleted: true,
      })
      expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result.startedAt).getTime(),
      )
      expect(result.enqueued).toEqual({ metadata: 1, thumbnails: 4, videos: 0, faces: 1, ai: 3 })

      // live profile untouched
      const after = await userRepo.findOneOrFail({ where: { id: target.id } })
      expect(after).toMatchObject({
        email,
        role: 'user',
        passwordHash: 'target-hash',
        displayName: 'Target Profile',
        tokensValidAfter: null,
      })

      // old UUIDs re-created under the target; bytes live under the target namespace
      const fileAfter = await fileRepo.findOneOrFail({ where: { id: legacy.file.id } })
      expect(fileAfter.userId).toBe(target.id)
      expect(fileAfter.storageKey.startsWith(`originals/${target.id}/`)).toBe(true)
      expect(await readFile(storage.pathFor(fileAfter.storageKey))).toEqual(legacy.bytes)
      const assetAfter = await assetRepo.findOneOrFail({ where: { id: legacy.asset.id } })
      expect(assetAfter).toMatchObject({
        userId: target.id,
        fileId: legacy.file.id,
        favorite: true,
        faceCount: 2,
        metadataStatus: 'pending',
        thumbnailStatus: 'pending',
        faceStatus: 'pending',
        embeddingStatus: 'pending',
        phash: null,
        transcodeFileId: null,
      })
      const albumAfter = await albumRepo.findOneOrFail({ where: { id: legacy.album.id } })
      expect(albumAfter.userId).toBe(target.id)
      await albumAssetRepo.findOneOrFail({
        where: { albumId: legacy.album.id, assetId: legacy.asset.id },
      })
      const shareAfter = await shareRepo.findOneOrFail({ where: { id: legacy.share.id } })
      expect(shareAfter).toMatchObject({ userId: target.id, assetId: legacy.asset.id })
      expect(shareAfter.expiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'))
      const personAfter = await personRepo.findOneOrFail({ where: { id: legacy.person.id } })
      expect(personAfter).toMatchObject({
        userId: target.id,
        name: 'Mom',
        clusterLabel: 'c1',
        faceCount: 5,
        coverFaceId: null,
      })

      // adoption moved the snapshot into the target's own prefix and deleted the
      // source: no legacyBackups sub-row material remains
      const targetPrefix = backupPrefix(email, target.id)
      expect(result.assigned!.prefix).toBe(targetPrefix)
      await expect(fake.listKeys(legacyPrefix)).resolves.toEqual([])
      const targetKeys = await fake.listKeys(targetPrefix)
      expect(targetKeys).toHaveLength(2)
      expect(targetKeys).toEqual(
        expect.arrayContaining([
          manifestKey(email, target.id),
          originalKey(email, target.id, legacy.file.id, 'bin'),
        ]),
      )

      const targetManifest = JSON.parse(
        (await fake.getBuffer(manifestKey(email, target.id))).toString('utf-8'),
      ) as UserBackupManifest
      expect(targetManifest).toMatchObject({
        userId: target.id,
        emailAtBackup: email,
        user: { id: target.id, passwordHash: 'target-hash' },
      })
      // adoption reuses the source snapshot's backedUpAt — same content, one run
      expect(targetManifest.backedUpAt).toBe(legacyBackup.backedUpAt)
      expect(targetManifest.files).toHaveLength(1)
      expect(targetManifest.assets).toHaveLength(1)
      expect(targetManifest.albums).toHaveLength(1)
      expect(targetManifest.albumAssets).toHaveLength(1)
      expect(targetManifest.shares).toHaveLength(1)
      expect(targetManifest.persons).toHaveLength(1)
      expect(targetManifest.files[0]).toMatchObject({
        userId: target.id,
        assetId: legacy.asset.id,
      })
      expect(targetManifest.assets[0]!.userId).toBe(target.id)
      // every manifest entry has its original bytes under the target prefix
      for (const entry of targetManifest.files) {
        const ext = entry.storageKey.slice(entry.storageKey.lastIndexOf('.') + 1)
        expect(fake.objects.has(originalKey(email, target.id, entry.id, ext))).toBe(true)
      }

      // durable ledger
      const ledger = await mergeRepo.findOneOrFail({
        where: { backupUserId: legacyId, targetUserId: target.id },
      })
      expect(ledger.prefix).toBe(legacyPrefix)
      expect(ledger.counts).toMatchObject({ files: 1, assets: 1 })

      // the live row is now the normal backup: its own manifest at the target
      // prefix, no previous-account sub-row and no mergedAt/backupUserId extras
      const row = (await svc.backupOverview()).find((r) => r.userId === target.id)!
      expect(row).toMatchObject({
        deleted: false,
        exists: true,
        totalAssets: 1,
        backedUpAssets: 1,
        backedUpFiles: 1,
      })
      // live rows never carry prefix/legacyBackups — only orphans and snapshot
      // sub-rows do; the adopted backup is the live row itself
      expect(row.prefix).toBeUndefined()
      expect(row.legacyBackups).toBeUndefined()
      await expect(svc.backupStatus(email)).resolves.toMatchObject({ exists: true, files: 1 })

      // the adopted manifest is a valid incremental predecessor: a rerun re-uploads
      // nothing
      const nextBackup = await svc.backupUser(target.id)
      expect(nextBackup).toMatchObject({ uploaded: 0, skipped: 1 })

      const metadataJobs = await queueJobsFor('process-metadata', target.id)
      expect(metadataJobs.map((data) => data.assetId)).toContain(legacy.asset.id)
    }, 120_000)

    it('recovers from a failed adoption with a retry that replays the merge', async () => {
      const email = `merge-retry-${randomUUID()}@example.com`
      const legacy = await seedAccount(email)
      const legacyPrefix = (await svc.backupUser(legacy.user.id)).prefix
      const legacyId = legacy.user.id
      await deleteAccountRows(legacyId)

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Retry Target',
        }),
      )

      // Rows/bytes land, then adoption's S3 copy fails: no ledger, source kept, so
      // a plain retry is still allowed.
      fake.failNextCopies = 1
      const failed = await svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: legacyId,
      })
      expect(failed.assigned).toBeNull()
      expect(failed.adoptionError).toContain('injected copyKey failure')
      expect((await fake.listKeys(legacyPrefix)).length).toBeGreaterThan(0)
      expect(
        await mergeRepo.findOne({
          where: { backupUserId: legacyId, targetUserId: target.id },
        }),
      ).toBeNull()

      // The retry finds the already-merged rows (skipped), re-enqueues their
      // derivatives, adopts the source and removes it.
      const retry = await svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: legacyId,
        force: true,
      })
      expect(retry.skipped.assets).toBe(1)
      expect(retry.enqueued).toEqual({ metadata: 1, thumbnails: 4, videos: 0, faces: 1, ai: 3 })
      expect(retry.assigned).toMatchObject({
        prefix: backupPrefix(email, target.id),
        sourceDeleted: true,
      })
      await expect(fake.listKeys(legacyPrefix)).resolves.toEqual([])
    }, 120_000)

    it('dedupes identical originals and relinks album/share targets to the live asset', async () => {
      const email = `merge-dedupe-${randomUUID()}@example.com`
      const bytes = Buffer.from('merge-dedupe-shared-bytes')
      const legacyUser = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'legacy-hash',
          displayName: 'Legacy Dedupe',
        }),
      )
      const legacyFile = await seedOriginal(legacyUser.id, bytes)
      const legacyAsset = await assetRepo.save(
        assetRepo.create({ userId: legacyUser.id, kind: 'photo', fileId: legacyFile.record.id }),
      )
      const legacyAlbum = await albumRepo.save(
        albumRepo.create({ userId: legacyUser.id, name: 'Dedupe Album', description: null }),
      )
      await albumAssetRepo.save(
        albumAssetRepo.create({ albumId: legacyAlbum.id, assetId: legacyAsset.id }),
      )
      const legacyShare = await shareRepo.save(
        shareRepo.create({
          userId: legacyUser.id,
          kind: 'asset',
          assetId: legacyAsset.id,
          albumId: null,
          token: createHash('sha256').update(randomUUID()).digest('hex'),
          expiresAt: null,
        }),
      )
      await svc.backupUser(legacyUser.id)
      await deleteAccountRows(legacyUser.id)

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target Dedupe',
        }),
      )
      const targetFile = await seedOriginal(target.id, bytes)
      const targetAsset = await assetRepo.save(
        assetRepo.create({ userId: target.id, kind: 'photo', fileId: targetFile.record.id }),
      )

      const result = await svc.mergeUserBackup({
        targetEmailOrId: email,
        backupUserId: legacyUser.id,
      })
      expect(result.deduped).toEqual({ files: 1, assets: 1 })
      expect(result.merged).toMatchObject({ files: 0, assets: 0, albums: 1, shares: 1 })
      expect(await assetRepo.findOne({ where: { id: legacyAsset.id } })).toBeNull()
      expect(await fileRepo.findOne({ where: { id: legacyFile.record.id } })).toBeNull()
      await albumAssetRepo.findOneOrFail({
        where: { albumId: legacyAlbum.id, assetId: targetAsset.id },
      })
      const shareAfter = await shareRepo.findOneOrFail({ where: { id: legacyShare.id } })
      expect(shareAfter).toMatchObject({ userId: target.id, assetId: targetAsset.id })
      expect(result.assigned).toMatchObject({
        prefix: backupPrefix(email, target.id),
        copiedObjects: 1,
        reusedObjects: 0,
        unionedWithExisting: false,
        sourceDeleted: true,
      })
      // the adopted manifest references the live rows the merge relinked to, never
      // the deduped legacy ids
      const targetManifest = JSON.parse(
        (await fake.getBuffer(manifestKey(email, target.id))).toString('utf-8'),
      ) as UserBackupManifest
      expect(targetManifest.files.map((file) => file.id)).toEqual([targetFile.record.id])
      expect(targetManifest.assets.map((asset) => asset.id)).toEqual([targetAsset.id])
      expect(targetManifest.files.some((file) => file.id === legacyFile.record.id)).toBe(false)
      expect(targetManifest.assets.some((asset) => asset.id === legacyAsset.id)).toBe(false)
      // the source copy is gone; the single remaining original lives under the
      // target prefix under the live file id
      expect([...fake.objects.keys()].filter((key) => key.includes('/originals/'))).toEqual([
        originalKey(email, target.id, targetFile.record.id, 'bin'),
      ])
      expect(result.enqueued).toEqual({ metadata: 0, thumbnails: 0, videos: 0, faces: 0, ai: 0 })
    }, 120_000)

    it('rejects an email mismatch, a second merge and a missing source', async () => {
      const email = `merge-conflict-${randomUUID()}@example.com`
      const legacy = await seedAccount(email)
      await svc.backupUser(legacy.user.id)
      await deleteAccountRows(legacy.user.id)

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Conflict Target',
        }),
      )
      const other = await userRepo.save(
        userRepo.create({
          email: `other-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Other',
        }),
      )

      // Mismatch runs before the successful merge: adoption deletes the source, so
      // the email check must see the snapshot while it still exists.
      const mismatch = await svc
        .mergeUserBackup({ targetEmailOrId: other.id, backupUserId: legacy.user.id, force: true })
        .catch((err: unknown) => err)
      expect(mismatch).toBeInstanceOf(ConflictException)
      expect((mismatch as ConflictException).message).toContain('email-mismatch')

      await svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id })

      // The ledger check runs before source resolution: the source is gone now, but
      // a plain repeat must still answer 409 already-merged instead of 404.
      const second = await svc
        .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id })
        .catch((err: unknown) => err)
      expect(second).toBeInstanceOf(ConflictException)
      expect((second as ConflictException).message).toContain('already-merged')

      await expect(
        svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: randomUUID() }),
      ).rejects.toThrow(NotFoundException)
    }, 120_000)

    it('enforces STORAGE_QUOTA_BYTES on incoming bytes unless force is set', async () => {
      const previous = process.env.STORAGE_QUOTA_BYTES
      process.env.STORAGE_QUOTA_BYTES = '8'
      try {
        const email = `merge-quota-${randomUUID()}@example.com`
        const legacy = await seedAccount(email)
        const legacyPrefix = (await svc.backupUser(legacy.user.id)).prefix
        await deleteAccountRows(legacy.user.id)
        const target = await userRepo.save(
          userRepo.create({
            email,
            role: 'user',
            passwordHash: 'target-hash',
            displayName: 'Quota Target',
          }),
        )

        const rejected = await svc
          .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id })
          .catch((err: unknown) => err)
        expect(rejected).toBeInstanceOf(PayloadTooLargeException)
        expect((rejected as Error).message).toMatch(/used \d+ \+ incoming \d+ > quota 8/)

        const forced = await svc.mergeUserBackup({
          targetEmailOrId: target.id,
          backupUserId: legacy.user.id,
          force: true,
        })
        expect(forced.merged.files).toBe(1)
        expect(forced.assigned).toMatchObject({
          prefix: backupPrefix(email, target.id),
          sourceDeleted: true,
        })
        await expect(fake.listKeys(legacyPrefix)).resolves.toEqual([])
      } finally {
        if (previous === undefined) delete process.env.STORAGE_QUOTA_BYTES
        else process.env.STORAGE_QUOTA_BYTES = previous
      }
    }, 120_000)
  })
})
