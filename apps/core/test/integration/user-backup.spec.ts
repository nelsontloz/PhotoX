import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { NotFoundException, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm'
import { LocalStorageService } from '@photox/shared-config'
import { DataSource, type Repository } from 'typeorm'
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
import { S3BackupService } from '../../src/backup/s3-backup.service'
import { UserBackupService } from '../../src/backup/user-backup.service'
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
]

interface FakeOp {
  op: 'putObject' | 'putFile'
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

  async ensureBucket(): Promise<void> {
    // in-memory stand-in — nothing to provision
  }

  getBucket(): string {
    return 'photox-test-backups'
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

  async downloadToFile(key: string, destPath: string): Promise<void> {
    await writeFile(destPath, await this.getBuffer(key))
  }

  listKeys(prefix: string): Promise<string[]> {
    return Promise.resolve([...this.objects.keys()].filter((k) => k.startsWith(prefix)))
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

  beforeAll(async () => {
    const { pgHost, pgPort } = await setupTestInfra()
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
            database: 'photox',
            entities: ENTITIES,
            synchronize: true,
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
        'app_settings RESTART IDENTITY CASCADE',
    )
    rmSync(storageDir, { recursive: true, force: true })
    await storage.ensureDir()
    fake.objects.clear()
    fake.ops = []
    fake.failNextPuts = 0
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

  async function wipeUserData(): Promise<void> {
    await dataSource.query(
      'TRUNCATE users, files, assets, albums, album_assets, shares, persons ' +
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
    return jobs
      .map((j) => j.data as JobData)
      .filter((d) => d.userId === userId)
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
    await albumAssetRepo.save(
      albumAssetRepo.create({ albumId: album.id, assetId: photoAsset.id }),
    )
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
    expect(result.restoredFrom.endsWith('manifest.json')).toBe(true)
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
    expect(metadataJobs.map((d) => d.assetId).sort()).toEqual(
      [photoAsset.id, videoAsset.id].sort(),
    )
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

  it('backupStatus is false for unknown users and missing manifests (A4)', async () => {
    await expect(
      svc.backupStatus(`ghost-${randomUUID()}@example.com`),
    ).resolves.toEqual({ exists: false })

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
})
