import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { vi } from 'vitest';
import { Worker } from 'bullmq';
import {
  LocalStorageService,
  backupPrefix,
  loadEnv,
  manifestKey,
  originalKey,
} from '@photox/shared-config';
import { DataSource, In, type Repository } from 'typeorm';
import { Asset, FileRecord, Person } from '../../src/database/entities';
import { Album } from '../../src/database/entities/album.entity';
import { AlbumAsset } from '../../src/database/entities/album-asset.entity';
import { Share } from '../../src/database/entities/share.entity';
import { User } from '../../src/database/entities/user.entity';
import { BackupModule } from '../../src/backup/backup.module';
import { BackupMerge } from '../../src/database/entities/backup-merge.entity';
import { BackupRun } from '../../src/database/entities/backup-run.entity';
import { S3BackupService } from '../../src/backup/s3-backup.service';
import {
  UserBackupService,
  buildFallbackEmail,
  type BackupResult,
  type RestoreResult,
  type UserBackupManifest,
} from '../../src/backup/user-backup.service';
import {
  BACKUP_TRANSFER_QUEUE,
  RESTORE_TRANSFER_QUEUE,
  type TransferJobData,
} from '../../src/backup/backup-transfer.constants';
import { BullMqModule } from '../../src/queue/bullmq.module';
import { BullMqService } from '../../src/queue/bullmq.service';
import { setupTestInfra, teardownTestInfra } from './test-setup';
import { ENTITIES } from './entities';

interface FakeOp {
  op: 'putObject' | 'putFile' | 'deleteKey' | 'copyKey';
  key: string;
}

/**
 * In-memory S3BackupService stand-in — backup specs never need Floci/docker.
 * Records put order so M3 (bytes first, manifest last) is assertable, and can
 * inject a mid-run putFile failure for the rerun-after-failure case.
 */
class FakeS3BackupService {
  objects = new Map<string, Buffer>();

  ops: FakeOp[] = [];

  failNextPuts = 0;

  putAttempts = 0;

  failNextDownloads = 0;

  failNextCopies = 0;

  failListKeys = false;

  async ensureBucket(): Promise<void> {
    // in-memory stand-in — nothing to provision
  }

  putObject(key: string, body: Buffer): Promise<void> {
    this.ops.push({ op: 'putObject', key });
    this.objects.set(key, Buffer.from(body));
    return Promise.resolve();
  }

  async putFile(key: string, localPath: string): Promise<void> {
    this.putAttempts += 1;
    if (this.failNextPuts > 0) {
      this.failNextPuts -= 1;
      throw new Error('injected putFile failure');
    }
    this.ops.push({ op: 'putFile', key });
    this.objects.set(key, await readFile(localPath));
  }

  getBuffer(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) {
      const err = new Error(`missing key ${key}`);
      err.name = 'NoSuchKey';
      throw err;
    }
    return Promise.resolve(Buffer.from(found));
  }

  headObject(key: string): Promise<void> {
    if (!this.objects.has(key)) {
      const err = new Error(`missing key ${key}`);
      err.name = 'NoSuchKey';
      throw err;
    }
    return Promise.resolve();
  }

  copyKey(srcKey: string, dstKey: string): Promise<void> {
    if (this.failNextCopies > 0) {
      this.failNextCopies -= 1;
      throw new Error('injected copyKey failure');
    }
    const found = this.objects.get(srcKey);
    if (!found) {
      const err = new Error(`missing key ${srcKey}`);
      err.name = 'NoSuchKey';
      throw err;
    }
    this.ops.push({ op: 'copyKey', key: dstKey });
    this.objects.set(dstKey, Buffer.from(found));
    return Promise.resolve();
  }

  async copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
    for (const key of await this.listKeys(srcPrefix)) {
      if (key.endsWith('/manifest.json')) continue;
      await this.copyKey(key, `${dstPrefix}${key.slice(srcPrefix.length)}`);
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    if (this.failNextDownloads > 0) {
      this.failNextDownloads -= 1;
      const err = new Error(`injected download failure ${key}`);
      err.name = 'NoSuchKey';
      throw err;
    }
    await writeFile(destPath, await this.getBuffer(key));
  }

  listKeys(prefix: string): Promise<string[]> {
    if (this.failListKeys) return Promise.reject(new Error('injected listKeys failure'));
    return Promise.resolve([...this.objects.keys()].filter((k) => k.startsWith(prefix)));
  }

  deleteKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.ops.push({ op: 'deleteKey', key });
      this.objects.delete(key);
    }
    return Promise.resolve();
  }
}

interface JobData {
  assetId?: string;
  kind?: string;
  userId?: string;
}

describe('user backup round-trip', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: LocalStorageService;
  let storageDir = '';
  let prevStorageDir: string | undefined;
  let svc: UserBackupService;
  let bullMq: BullMqService;
  let fake: FakeS3BackupService;
  let userRepo: Repository<User>;
  let fileRepo: Repository<FileRecord>;
  let assetRepo: Repository<Asset>;
  let albumRepo: Repository<Album>;
  let albumAssetRepo: Repository<AlbumAsset>;
  let shareRepo: Repository<Share>;
  let personRepo: Repository<Person>;
  let mergeRepo: Repository<BackupMerge>;

  beforeAll(async () => {
    const { pgHost, pgPort, pgDb } = await setupTestInfra();
    storageDir = mkdtempSync(join(tmpdir(), 'backup-int-storage-'));
    prevStorageDir = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = storageDir;
    fake = new FakeS3BackupService();
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
            // schema comes from the template database the global setup bakes per run
            synchronize: false,
            poolSize: 5,
          }),
          TypeOrmModule.forFeature(ENTITIES),
          BullMqModule,
          BackupModule,
        ],
      })
        .overrideProvider(S3BackupService)
        .useValue(fake)
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
      dataSource = app.get<DataSource>(DataSource);
      storage = app.get<LocalStorageService>(LocalStorageService);
      svc = app.get<UserBackupService>(UserBackupService);
      bullMq = app.get<BullMqService>(BullMqService);
      userRepo = app.get<Repository<User>>(getRepositoryToken(User));
      fileRepo = app.get<Repository<FileRecord>>(getRepositoryToken(FileRecord));
      assetRepo = app.get<Repository<Asset>>(getRepositoryToken(Asset));
      albumRepo = app.get<Repository<Album>>(getRepositoryToken(Album));
      albumAssetRepo = app.get<Repository<AlbumAsset>>(getRepositoryToken(AlbumAsset));
      shareRepo = app.get<Repository<Share>>(getRepositoryToken(Share));
      personRepo = app.get<Repository<Person>>(getRepositoryToken(Person));
      mergeRepo = app.get<Repository<BackupMerge>>(getRepositoryToken(BackupMerge));
    } catch (err) {
      if (prevStorageDir === undefined) delete process.env.STORAGE_DIR;
      else process.env.STORAGE_DIR = prevStorageDir;
      throw err;
    }
  }, 120_000);

  afterAll(async () => {
    await app.close();
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = prevStorageDir;
    await teardownTestInfra();
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE users, files, assets, albums, album_assets, shares, persons, ' +
        'app_settings, backup_merges, backup_runs RESTART IDENTITY CASCADE',
    );
    rmSync(storageDir, { recursive: true, force: true });
    await storage.ensureDir();
    fake.objects.clear();
    fake.ops = [];
    fake.failNextPuts = 0;
    fake.putAttempts = 0;
    fake.failNextDownloads = 0;
    fake.failNextCopies = 0;
    fake.failListKeys = false;
  });

  async function seedOriginal(
    userId: string,
    bytes: Buffer,
    opts?: { mimeType?: string; originalName?: string },
  ): Promise<{ record: FileRecord; bytes: Buffer }> {
    const storageKey = `originals/${userId}/${randomUUID()}.bin`;
    await mkdir(dirname(storage.pathFor(storageKey)), { recursive: true });
    await writeFile(storage.pathFor(storageKey), bytes);
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
    );
    return { record, bytes };
  }

  async function seedFile(
    userId: string,
    storageKey: string,
    bytes: Buffer,
    opts?: { mimeType?: string; originalName?: string; purpose?: 'original' | 'transcode' },
  ): Promise<FileRecord> {
    await mkdir(dirname(storage.pathFor(storageKey)), { recursive: true });
    await writeFile(storage.pathFor(storageKey), bytes);
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
    );
  }

  async function wipeUserData(): Promise<void> {
    await dataSource.query(
      'TRUNCATE users, files, assets, albums, album_assets, shares, persons, backup_merges, backup_runs ' +
        'RESTART IDENTITY CASCADE',
    );
    rmSync(storageDir, { recursive: true, force: true });
    await storage.ensureDir();
  }

  function expectManifestLast(): void {
    const manifestIdx = fake.ops.findIndex((o) => o.key.endsWith('manifest.json'));
    expect(manifestIdx).toBeGreaterThan(-1);
    const byteOps = fake.ops.filter((o) => o.op === 'putFile');
    expect(byteOps.length).toBeGreaterThan(0);
    for (const op of byteOps) {
      expect(fake.ops.indexOf(op)).toBeLessThan(manifestIdx);
    }
  }

  async function queueJobsFor(queueName: string, userId: string): Promise<JobData[]> {
    const jobs = await bullMq.getQueue(queueName).getJobs(['waiting', 'delayed', 'active']);
    return jobs.map((j) => j.data as JobData).filter((d) => d.userId === userId);
  }

  /**
   * Drives the real ledger path (claim -> consume -> finalize) to a terminal run. The
   * production executor is the queue pair; this is only its synchronous stand-in.
   */
  async function driveRun<T extends BackupResult | RestoreResult>(
    runId: string,
    label: string,
  ): Promise<T> {
    for (let pass = 0; pass < 200; pass++) {
      const status = await svc.getRunStatus(runId);
      if (status.state === 'completed') return status.result as T;
      if (status.state !== 'running' && status.state !== 'finalizing') {
        throw new Error(status.error ?? `${label} ${status.state}`);
      }
      if ((await svc.runTransfersOnce(true)) === 0) {
        const after = await svc.getRunStatus(runId);
        if (after.state === 'completed') return after.result as T;
        throw new Error(after.error ?? `${label} stalled in ${after.state}`);
      }
    }
    throw new Error(`${label} did not finish`);
  }

  async function runBackup(emailOrId: string): Promise<BackupResult> {
    const { runId } = await svc.startBackup(emailOrId);
    return driveRun<BackupResult>(runId, 'Backup');
  }

  async function runRestore(emailOrId: string, restoreEmail?: string): Promise<RestoreResult> {
    const { runId } = await svc.startRestore(emailOrId, restoreEmail);
    return driveRun<RestoreResult>(runId, 'Restore');
  }

  it('backs up and restores one user via EMAIL with same UUIDs (M1/M2/M4)', async () => {
    const email = `backup-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Backup User',
      }),
    );

    const photo = await seedOriginal(user.id, Buffer.from('backup-photo-bytes'), {
      mimeType: 'image/png',
      originalName: 'photo.png',
    });
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
    );

    const video = await seedOriginal(user.id, Buffer.from('backup-video-bytes'), {
      mimeType: 'video/mp4',
      originalName: 'clip.mp4',
    });
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
    );

    const trash = await seedOriginal(user.id, Buffer.from('backup-trash-bytes'));
    const trashedAsset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: trash.record.id,
        isTrashed: true,
        trashedAt: new Date(),
        mimeType: 'image/png',
      }),
    );

    const album = await albumRepo.save(
      albumRepo.create({
        userId: user.id,
        name: 'Trip',
        description: null,
        hiddenFromTimeline: true,
      }),
    );
    await albumAssetRepo.save(albumAssetRepo.create({ albumId: album.id, assetId: photoAsset.id }));
    const token = createHash('sha256').update(randomUUID()).digest('hex');
    const share = await shareRepo.save(
      shareRepo.create({
        userId: user.id,
        kind: 'asset',
        assetId: photoAsset.id,
        albumId: null,
        token,
        expiresAt: null,
      }),
    );
    const person = await personRepo.save(
      personRepo.create({
        userId: user.id,
        name: 'Mom',
        coverFaceId: randomUUID(),
        clusterLabel: 'c1',
        faceCount: 5,
      }),
    );

    // M1: EMAIL identifier (uppercased) — pre-fix this 500s on the uuid-typed lookup
    const backed = await runBackup(email.toUpperCase());
    expect(backed).toMatchObject({
      userId: user.id,
      files: 3,
      assets: 3,
      albums: 1,
      shares: 1,
      persons: 1,
    });
    expectManifestLast();

    // the timeline flag is part of the manifest, or a restored album reappears in the timeline
    const manifestObjectKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const manifest = JSON.parse((await fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      albums: { id: string; hiddenFromTimeline?: boolean }[];
    };
    expect(manifest.albums).toHaveLength(1);
    expect(manifest.albums[0]).toMatchObject({ id: album.id, hiddenFromTimeline: true });

    const status = await svc.backupStatus(email.toUpperCase());
    expect(status).toMatchObject({ exists: true, userId: user.id, files: 3 });

    await wipeUserData();

    // M4: RestoreResult records the window cleanup-orphans must stay paused across
    const result = await runRestore(email.toUpperCase());
    expect(result.userId).toBe(user.id);
    expect(result.email).toBe(email);
    expect(result.restoredFrom.emailAtBackup).toBe(email);
    expect(result.restoredFrom.prefix).toBe(result.prefix);
    expect(result.restoredFrom.manifestObjectKey.endsWith('manifest.json')).toBe(true);
    expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(
      // startedAt comes from the DB row, completedAt from the process clock: allow ms skew
      new Date(result.startedAt).getTime() - 5_000,
    );
    // M2: video gets a metadata job too — 2 live assets (trashed excluded)
    expect(result.enqueued).toEqual({ metadata: 2, thumbnails: 8, videos: 1, faces: 1, ai: 2 });

    const restoredUser = await userRepo.findOneOrFail({ where: { id: user.id } });
    expect(restoredUser.email).toBe(email);

    for (const f of [photo, video, trash]) {
      const row = await fileRepo.findOneOrFail({ where: { id: f.record.id } });
      expect(row.storageKey).toBe(f.record.storageKey);
      expect(await readFile(storage.pathFor(row.storageKey))).toEqual(f.bytes);
    }

    for (const id of [photoAsset.id, videoAsset.id]) {
      const row = await assetRepo.findOneOrFail({ where: { id } });
      expect(row.metadataStatus).toBe('pending');
      expect(row.metadataExtractedAt).toBeNull();
      expect(row.phash).toBeNull();
      expect(row.transcodeFileId).toBeNull();
    }
    const trashedAfter = await assetRepo.findOneOrFail({ where: { id: trashedAsset.id } });
    expect(trashedAfter.isTrashed).toBe(true);
    expect(trashedAfter.trashedAt).not.toBeNull();

    const albumAfter = await albumRepo.findOneOrFail({ where: { id: album.id } });
    expect(albumAfter.hiddenFromTimeline).toBe(true);
    await albumAssetRepo.findOneOrFail({
      where: { albumId: album.id, assetId: photoAsset.id },
    });
    const shareAfter = await shareRepo.findOneOrFail({ where: { id: share.id } });
    expect(shareAfter.token).toBe(token);
    const personAfter = await personRepo.findOneOrFail({ where: { id: person.id } });
    expect(personAfter.coverFaceId).toBeNull();
    // A3: faceCount stays stale until the restore cluster job runs
    expect(personAfter.faceCount).toBe(5);

    const metadataJobs = await queueJobsFor('process-metadata', user.id);
    expect(metadataJobs.map((d) => d.assetId).sort()).toEqual(
      [photoAsset.id, videoAsset.id].sort(),
    );
    expect(metadataJobs.find((d) => d.assetId === videoAsset.id)?.kind).toBe('video');

    const videoJobs = await queueJobsFor('process-video', user.id);
    expect(videoJobs.some((d) => d.assetId === videoAsset.id)).toBe(true);
    expect(videoJobs.some((d) => d.assetId === photoAsset.id)).toBe(false);

    const thumbJobs = await queueJobsFor('process-thumbnail', user.id);
    expect(thumbJobs.filter((d) => d.assetId === photoAsset.id)).toHaveLength(4);
    expect(thumbJobs.filter((d) => d.assetId === videoAsset.id)).toHaveLength(4);

    // M1: unknown email is a 404, never a uuid-typed 500 (QueryFailedError 22P02)
    await expect(runBackup('no-such-user@example.com')).rejects.toThrow(NotFoundException);
  });

  // Compatibility: a backup taken before `hiddenFromTimeline` existed must still restore —
  // the zod default supplies false, exactly the behaviour that backup had.
  it('restores a manifest that predates hiddenFromTimeline', async () => {
    const email = `legacy-album-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Legacy Album User',
      }),
    );
    const photo = await seedOriginal(user.id, Buffer.from('legacy-album-bytes'), {
      mimeType: 'image/png',
      originalName: 'legacy-album.png',
    });
    const asset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: photo.record.id,
        isTrashed: false,
        mimeType: 'image/png',
      }),
    );
    const album = await albumRepo.save(
      albumRepo.create({ userId: user.id, name: 'Old Trip', description: null }),
    );
    await albumAssetRepo.save(albumAssetRepo.create({ albumId: album.id, assetId: asset.id }));

    await runBackup(user.id);

    // rewrite the published manifest as an old core would have written it
    const manifestObjectKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const stored = JSON.parse((await fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      albums: Record<string, unknown>[];
    };
    delete stored.albums[0]!.hiddenFromTimeline;
    await fake.putObject(manifestObjectKey, Buffer.from(JSON.stringify(stored)));

    await wipeUserData();
    await runRestore(user.id);

    const albumAfter = await albumRepo.findOneOrFail({ where: { id: album.id } });
    expect(albumAfter.hiddenFromTimeline).toBe(false);
  });

  // Regression: an Asset row binds ~47 columns, so a 10k-asset restore used to emit a single
  // INSERT and Postgres rejected it (65,535 bind parameters). Restore must chunk its saves.
  it('restores a manifest far above the single-statement bind limit (1,600 assets)', async () => {
    const email = `bulk-restore-${randomUUID()}@example.com`;
    const userId = randomUUID();
    const files = Array.from({ length: 1600 }, () => {
      const id = randomUUID();
      return {
        id,
        userId,
        storageKey: `originals/${userId}/${id}.png`,
        originalName: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 4,
        checksumSha256: createHash('sha256').update(id).digest('hex'),
        purpose: 'original' as const,
        assetId: null,
      };
    });
    const assets = files.map((file) => ({
      id: randomUUID(),
      userId,
      kind: 'photo' as const,
      fileId: file.id,
      isTrashed: false,
      trashedAt: null,
      title: null,
      description: null,
      takenAt: null,
      favorite: false,
      mimeType: 'image/png',
      sizeBytes: 4,
      originalName: 'photo.png',
      width: 1,
      height: 1,
      durationSeconds: null,
      cameraMake: null,
      cameraModel: null,
      lensModel: null,
      orientation: null,
      iso: null,
      fNumber: null,
      exposureTime: null,
      focalLength: null,
      latitude: null,
      longitude: null,
      altitude: null,
      placeCity: null,
      placeAdmin1: null,
      placeCountryCode: null,
      placeTimezone: null,
      placeDistanceKm: null,
      fps: null,
      codec: null,
      hasAudio: null,
      metadata: null,
      metadataStatus: 'ready' as const,
      transcodeStatus: null,
      thumbnailStatus: 'ready' as const,
      faceStatus: null,
      embeddingStatus: null,
      faceCount: null,
    }));
    const manifest: UserBackupManifest = {
      manifestVersion: 1,
      userId,
      emailAtBackup: email,
      backedUpAt: new Date().toISOString(),
      user: {
        id: userId,
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Bulk Restore',
        tokensValidAfter: null,
      },
      files,
      assets,
      albums: [],
      albumAssets: [],
      shares: [],
      persons: [],
    };
    await fake.putObject(manifestKey(email, userId), Buffer.from(JSON.stringify(manifest)));

    const { runId } = await svc.startRestore(userId);

    expect(await fileRepo.count({ where: { userId } })).toBe(1600);
    expect(await assetRepo.count({ where: { userId } })).toBe(1600);
    await expect(svc.getRunStatus(runId)).resolves.toMatchObject({
      kind: 'restore',
      state: 'running',
      total: 1600,
    });
  }, 120_000);

  // Regression: BullMQ dedups by jobId, so deterministic restore jobIds swallowed every
  // add of a later restore of the same user as `duplicated` when completed records were
  // retained — originals came back but no derivative regenerated (places worked:
  // synchronous backfill). Completed jobs are removed now (removeOnComplete defaults to
  // true), but a delayed/active job still holds its id, so each run keeps its own tag.
  it('re-enqueues derivatives on a second restore instead of deduping into retained records', async () => {
    const email = `restore-twice-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Twice User',
      }),
    );

    const photo = await seedOriginal(user.id, Buffer.from('twice-photo-bytes'), {
      mimeType: 'image/png',
      originalName: 'photo.png',
    });
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
    );
    const video = await seedOriginal(user.id, Buffer.from('twice-video-bytes'), {
      mimeType: 'video/mp4',
      originalName: 'clip.mp4',
    });
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
    );

    await runBackup(email);
    await wipeUserData();

    // no media workers run in this app: boot trivial ones so the first restore's jobs
    // reach `completed` and their records are retained — exactly what the worker-service
    // leaves behind. Closed in `finally` so they never consume later specs' jobs.
    const runnableQueues = [
      'process-thumbnail',
      'process-video',
      'process-metadata',
      'process-faces',
      'process-embeddings',
      'process-detect',
    ] as const;
    const env = loadEnv();
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
    );
    try {
      await runRestore(email);
      for (const name of runnableQueues) {
        let runnable = 1;
        for (let i = 0; i < 300 && runnable > 0; i++) {
          runnable = (await queueJobsFor(name, user.id)).length;
          if (runnable > 0) await new Promise((r) => setTimeout(r, 100));
        }
        expect(runnable, `${name} still had runnable jobs`).toBe(0);
      }
    } finally {
      await Promise.all(workers.map((w) => w.close()));
    }

    // the delete path drains pending media jobs only — the completed records stay put,
    // so the second restore enqueues into ids that already exist
    await wipeUserData();

    const second = await runRestore(email);
    expect(second.enqueued).toEqual({ metadata: 2, thumbnails: 8, videos: 1, faces: 1, ai: 2 });

    // every family must be runnable again: pre-fix each of these adds was rejected as
    // `duplicated` against the retained record and nothing regenerated
    const thumbs = await queueJobsFor('process-thumbnail', user.id);
    expect(thumbs.filter((d) => d.assetId === photoAsset.id)).toHaveLength(4);
    expect(thumbs.filter((d) => d.assetId === videoAsset.id)).toHaveLength(4);
    const faces = await queueJobsFor('process-faces', user.id);
    expect(faces.filter((d) => d.assetId === photoAsset.id)).toHaveLength(1);
    const videos = await queueJobsFor('process-video', user.id);
    expect(videos.filter((d) => d.assetId === videoAsset.id)).toHaveLength(1);
    const embeds = await queueJobsFor('process-embeddings', user.id);
    expect(embeds.some((d) => d.assetId === photoAsset.id)).toBe(true);
    const detects = await queueJobsFor('process-detect', user.id);
    expect(detects.some((d) => d.assetId === photoAsset.id)).toBe(true);
  }, 120_000);

  it('reruns after a mid-run failure with bytes first and manifest last (M3)', async () => {
    const email = `rerun-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Rerun User',
      }),
    );
    const a = await seedOriginal(user.id, Buffer.from('rerun-a-bytes'));
    const b = await seedOriginal(user.id, Buffer.from('rerun-b-bytes'));
    await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: a.record.id,
        isTrashed: false,
      }),
    );
    await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: b.record.id,
        isTrashed: false,
      }),
    );

    // per-file retries: exhaust the attempt budget so the run still fails and writes no manifest
    fake.failNextPuts = 10;
    await expect(runBackup(user.id)).rejects.toThrow('injected putFile failure');
    // manifest-last: the failed run leaves no live manifest over missing bytes
    expect([...fake.objects.keys()].some((k) => k.endsWith('manifest.json'))).toBe(false);

    fake.ops = [];
    fake.failNextPuts = 0;
    const backed = await runBackup(user.id);
    expect(backed.files).toBe(2);
    expectManifestLast();

    await wipeUserData();
    const restored = await runRestore(email);
    expect(restored.files).toBe(2);
    for (const f of [a, b]) {
      const row = await fileRepo.findOneOrFail({ where: { id: f.record.id } });
      expect(await readFile(storage.pathFor(row.storageKey))).toEqual(f.bytes);
    }
  });

  it('drives a backup through the async ledger and reports run status', async () => {
    const email = `async-run-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Async Run',
      }),
    );
    const a = await seedOriginal(user.id, Buffer.from('async-run-a'));
    const b = await seedOriginal(user.id, Buffer.from('async-run-b'));
    await assetRepo.save([
      assetRepo.create({ userId: user.id, kind: 'photo', fileId: a.record.id, isTrashed: false }),
      assetRepo.create({ userId: user.id, kind: 'photo', fileId: b.record.id, isTrashed: false }),
    ]);

    const { runId } = await svc.startBackup(user.id);
    expect((await svc.getRunStatus(runId)).state).toBe('running');
    for (let i = 0; i < 20; i++) {
      if ((await svc.getRunStatus(runId)).state !== 'running') break;
      await svc.runTransfersOnce();
    }

    const status = await svc.getRunStatus(runId);
    expect(status.state).toBe('completed');
    expect(status.result).toMatchObject({ files: 2, uploaded: 2, skipped: 0 });
    expectManifestLast();
    // the progress endpoint maps the same run row
    expect(await svc.getBackupProgress(email)).toMatchObject({
      inProgress: false,
      total: 2,
      completed: 2,
    });
  });

  it('retries a transient file failure alone without failing the run', async () => {
    const email = `async-retry-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Async Retry',
      }),
    );
    const a = await seedOriginal(user.id, Buffer.from('async-retry-a'));
    const b = await seedOriginal(user.id, Buffer.from('async-retry-b'));
    await assetRepo.save([
      assetRepo.create({ userId: user.id, kind: 'photo', fileId: a.record.id, isTrashed: false }),
      assetRepo.create({ userId: user.id, kind: 'photo', fileId: b.record.id, isTrashed: false }),
    ]);

    fake.failNextPuts = 2;
    const { runId } = await svc.startBackup(user.id);
    for (let i = 0; i < 20; i++) {
      if ((await svc.getRunStatus(runId)).state !== 'running') break;
      // the ledger backs off between attempts; the API exposes the no-backoff driver for tests
      await svc.runTransfersOnce(true);
    }

    const status = await svc.getRunStatus(runId);
    expect(status.state).toBe('completed');
    expect(status.result).toMatchObject({ files: 2, uploaded: 2 });
    expect(fake.putAttempts).toBe(4);
    expectManifestLast();
  });

  it('resumes a failed restore of the same manifest instead of 409ing', async () => {
    const email = `async-resume-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Async Resume',
      }),
    );
    const photo = await seedOriginal(user.id, Buffer.from('async-resume-bytes'));
    const asset = await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: photo.record.id,
        isTrashed: false,
      }),
    );
    await runBackup(user.id);
    const key = originalKey(email, user.id, photo.record.id, 'bin');

    await wipeUserData();
    fake.objects.delete(key);

    const first = await svc.startRestore(user.id);
    for (let i = 0; i < 20; i++) {
      if ((await svc.getRunStatus(first.runId)).state !== 'running') break;
      await svc.runTransfersOnce();
    }
    const failed = await svc.getRunStatus(first.runId);
    expect(failed.state).toBe('failed');
    expect(failed.error).toContain('could not be restored');
    // no silent 404: the asset row came back but its bytes did not, so it is trashed
    expect((await assetRepo.findOneOrFail({ where: { id: asset.id } })).isTrashed).toBe(true);

    fake.objects.set(key, photo.bytes);
    const second = await svc.startRestore(user.id);
    expect(second.runId).toBe(first.runId);
    for (let i = 0; i < 20; i++) {
      if ((await svc.getRunStatus(second.runId)).state !== 'running') break;
      await svc.runTransfersOnce();
    }

    const done = await svc.getRunStatus(second.runId);
    expect(done.state).toBe('completed');
    expect(done.result).toMatchObject({ files: 1, assets: 1 });
    expect((await assetRepo.findOneOrFail({ where: { id: asset.id } })).isTrashed).toBe(false);
    const row = await fileRepo.findOneOrFail({ where: { id: photo.record.id } });
    expect(await readFile(storage.pathFor(row.storageKey))).toEqual(photo.bytes);
  });

  // Regression: `enqueue` swallows a Redis failure and returns false, so the old code counted
  // jobs that were never added and completed the run — assets restored, derivatives queued
  // nowhere, and no sweep for `pending`. A refused add must fail the run and stay retryable.
  it('fails a restore whose derivative enqueue is refused instead of reporting completed', async () => {
    const email = `enqueue-refused-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Enqueue Refused',
      }),
    );
    const photo = await seedOriginal(user.id, Buffer.from('enqueue-refused-bytes'));
    await assetRepo.save(
      assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: photo.record.id,
        isTrashed: false,
      }),
    );
    await runBackup(user.id);
    await wipeUserData();

    // Only the derivative family is refused: a blanket false also breaks the restore's own
    // transfer adds, which would prove nothing about this contract.
    const realEnqueue = bullMq.enqueue.bind(bullMq);
    const spy = vi
      .spyOn(bullMq, 'enqueue')
      .mockImplementation((queue, jobName, data, opts) =>
        queue === 'process-metadata'
          ? Promise.resolve(false)
          : realEnqueue(queue, jobName, data, opts),
      );
    let runId: string;
    try {
      ({ runId } = await svc.startRestore(user.id));
      for (let i = 0; i < 20; i++) {
        const state = (await svc.getRunStatus(runId)).state;
        if (state !== 'running' && state !== 'finalizing') break;
        await svc.runTransfersOnce();
      }
      const failed = await svc.getRunStatus(runId);
      expect(failed.state).toBe('failed');
      expect(failed.error).toContain('enqueue');
      expect(await queueJobsFor('process-metadata', user.id)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }

    // failed, not wedged: the same manifest resumes and the retry really enqueues
    const retry = await svc.startRestore(user.id);
    expect(retry.runId).toBe(runId);
    for (let i = 0; i < 20; i++) {
      const state = (await svc.getRunStatus(retry.runId)).state;
      if (state !== 'running' && state !== 'finalizing') break;
      await svc.runTransfersOnce();
    }
    const done = await svc.getRunStatus(retry.runId);
    expect(done.state).toBe('completed');
    expect(await queueJobsFor('process-metadata', user.id)).toHaveLength(1);
  });

  it('backs up original bytes only, skipping thumbnail/transcode derivatives', async () => {
    const email = `derivatives-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Derivatives User',
      }),
    );
    const original = await seedOriginal(user.id, Buffer.from('derivative-test-original'));
    const thumbBytes = Buffer.from('derivative-test-thumb');
    await seedFile(user.id, `derivatives/thumbnails/${user.id}/${randomUUID()}.webp`, thumbBytes, {
      mimeType: 'image/webp',
      originalName: 'thumb-sm.webp',
      purpose: 'original',
    });
    const transcodeBytes = Buffer.from('derivative-test-transcode');
    await seedFile(
      user.id,
      `derivatives/transcodes/${user.id}/${randomUUID()}.mp4`,
      transcodeBytes,
      { mimeType: 'video/mp4', originalName: 'clip-transcode.mp4', purpose: 'transcode' },
    );
    const legacyBytes = Buffer.from('derivative-test-legacy-transcode');
    await seedFile(user.id, `derivatives/transcodes/${user.id}/${randomUUID()}.mp4`, legacyBytes, {
      mimeType: 'video/mp4',
      originalName: 'legacy-transcode.mp4',
      purpose: 'original',
    });

    // pre-fix rerun leaves stale thumbnail bytes under originals/ — prune must delete them
    const staleKey = `${backupPrefix(email, user.id)}originals/${randomUUID()}.webp`;
    fake.objects.set(staleKey, Buffer.from('stale-thumb-bytes'));

    const backed = await runBackup(user.id);
    expect(backed.files).toBe(1);
    const putFiles = fake.ops.filter((o) => o.op === 'putFile');
    expect(putFiles).toHaveLength(1);
    const manifestObjectKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const manifest = JSON.parse((await fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      files: { id: string; storageKey: string }[];
    };
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]!.id).toBe(original.record.id);
    expect(manifest.files[0]!.storageKey.startsWith('originals/')).toBe(true);
    expectManifestLast();
    // stale pre-fix bytes are pruned only after the new manifest is published, expected
    // original remains
    expect(fake.objects.has(staleKey)).toBe(false);
    expect(fake.objects.has(putFiles[0]!.key)).toBe(true);
    const deletes = fake.ops.filter((o) => o.op === 'deleteKey');
    expect(deletes.map((o) => o.key)).toContain(staleKey);
    const manifestIdx = fake.ops.findIndex((o) => o.key.endsWith('manifest.json'));
    for (const op of deletes) {
      expect(fake.ops.indexOf(op)).toBeGreaterThan(manifestIdx);
    }

    const status = await svc.backupStatus(user.id);
    expect(status).toMatchObject({ exists: true, userId: user.id, files: 1 });
  });

  it('reports original-only status and skips derivatives on restore for legacy manifests', async () => {
    const email = `legacy-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Legacy User',
      }),
    );
    const original = await seedOriginal(user.id, Buffer.from('legacy-original-bytes'));
    const thumbBytes = Buffer.from('legacy-thumb-bytes');
    const thumb = await seedFile(
      user.id,
      `derivatives/thumbnails/${user.id}/${randomUUID()}.webp`,
      thumbBytes,
      { mimeType: 'image/webp', originalName: 'thumb-sm.webp', purpose: 'original' },
    );

    const backed = await runBackup(user.id);
    expect(backed.files).toBe(1);

    // splice a pre-fix derivative entry into the stored manifest plus its S3 bytes
    const manifestObjectKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const stored = JSON.parse((await fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      files: {
        id: string;
        userId: string;
        storageKey: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
        checksumSha256: string;
        purpose: 'original';
        assetId: string | null;
      }[];
    };
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
    });
    await fake.putObject(manifestObjectKey, Buffer.from(JSON.stringify(stored)));
    const prefix = manifestObjectKey.slice(0, -'manifest.json'.length);
    await fake.putFile(`${prefix}originals/${thumb.id}.webp`, storage.pathFor(thumb.storageKey));

    // status reports original-only despite the legacy derivative entry
    expect((await svc.backupStatus(user.id)).files).toBe(1);

    await wipeUserData();

    const restored = await runRestore(email);
    expect(restored.files).toBe(1);
    const restoredOriginal = await fileRepo.findOneOrFail({ where: { id: original.record.id } });
    expect(await readFile(storage.pathFor(restoredOriginal.storageKey))).toEqual(original.bytes);
    expect(await fileRepo.findOne({ where: { id: thumb.id } })).toBeNull();
    expect(await storage.exists(thumb.storageKey)).toBe(false);
    expect((await svc.backupStatus(email)).files).toBe(1);
  });

  it('backupStatus is false for unknown users and missing manifests (A4)', async () => {
    await expect(svc.backupStatus(`ghost-${randomUUID()}@example.com`)).resolves.toEqual({
      exists: false,
    });

    const email = `status-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Status User',
      }),
    );
    await seedOriginal(user.id, Buffer.from('status-bytes'));
    await runBackup(user.id);
    expect((await svc.backupStatus(email)).exists).toBe(true);

    for (const key of [...fake.objects.keys()]) {
      if (key.endsWith('manifest.json')) fake.objects.delete(key);
    }
    // isNotFound covers NoSuchKey/NotFound/NoSuchBucket, not one name
    await expect(svc.backupStatus(email)).resolves.toEqual({ exists: false });
  });

  describe('incremental gate + lazy rename', () => {
    async function seedUserWithFiles(
      count: number,
      prefixLabel: string,
    ): Promise<{ user: User; seeded: { record: FileRecord; bytes: Buffer }[] }> {
      const email = `${prefixLabel}-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: `${prefixLabel} User`,
        }),
      );
      const seeded = [];
      for (let i = 0; i < count; i++) {
        seeded.push(await seedOriginal(user.id, Buffer.from(`${prefixLabel}-bytes-${i}`)));
      }
      return { user, seeded };
    }

    it('skips all uploads on an unchanged rerun (uploaded 0, empty prune)', async () => {
      const { user } = await seedUserWithFiles(2, 'skipall');
      const first = await runBackup(user.id);
      expect(first.uploaded).toBe(2);
      expect(first.skipped).toBe(0);

      fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 0, skipped: 2 });
      expect(fake.ops.filter((o) => o.op === 'putFile')).toHaveLength(0);
      expect(fake.ops.filter((o) => o.op === 'putObject')).toHaveLength(1);
      // empty prune: no deletes when nothing is stale
      expect(fake.ops.filter((o) => o.op === 'deleteKey')).toHaveLength(0);
    });

    it('uploads only new files on the next run (delta-only)', async () => {
      const { user } = await seedUserWithFiles(2, 'delta');
      await runBackup(user.id);

      await seedOriginal(user.id, Buffer.from('delta-new-bytes'));
      fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 3, uploaded: 1, skipped: 2 });
      expect(fake.ops.filter((o) => o.op === 'putFile')).toHaveLength(1);
    });

    it('re-uploads when the checksum changes', async () => {
      const { user, seeded } = await seedUserWithFiles(2, 'checksum');
      await runBackup(user.id);

      const target = seeded[0]!.record;
      const nextBytes = Buffer.from('checksum-changed-bytes');
      await writeFile(storage.pathFor(target.storageKey), nextBytes);
      await fileRepo.update(target.id, {
        sizeBytes: nextBytes.length,
        checksumSha256: createHash('sha256').update(nextBytes).digest('hex'),
      });
      fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 1, skipped: 1 });
      const putKeys = fake.ops.filter((o) => o.op === 'putFile').map((o) => o.key);
      expect(putKeys).toHaveLength(1);
      expect(putKeys[0]).toContain(target.id);
    });

    it('falls back to a full upload on a missing manifest', async () => {
      const { user } = await seedUserWithFiles(2, 'missing-manifest');
      await runBackup(user.id);

      for (const key of [...fake.objects.keys()]) {
        if (key.endsWith('manifest.json')) fake.objects.delete(key);
      }
      fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 2, skipped: 0 });
    });

    it('falls back to a full upload on a corrupt manifest', async () => {
      const { user } = await seedUserWithFiles(2, 'corrupt-manifest');
      await runBackup(user.id);

      const manifestKey = fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
      fake.objects.set(manifestKey, Buffer.from('not-json{{{'));
      fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 2, skipped: 0 });
    });

    it('re-uploads S3-missing keys despite a manifest match', async () => {
      const { user } = await seedUserWithFiles(2, 's3missing');
      await runBackup(user.id);

      const originalKeys = [...fake.objects.keys()].filter((k) => k.includes('/originals/'));
      expect(originalKeys).toHaveLength(2);
      fake.objects.delete(originalKeys[0]!);
      fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 1, skipped: 1 });
      expect(fake.ops.filter((o) => o.op === 'putFile').map((o) => o.key)).toEqual([
        originalKeys[0],
      ]);
    });

    it('uploads all and skips prune when listKeys fails', async () => {
      const { user } = await seedUserWithFiles(1, 'listfail');
      await runBackup(user.id);
      // second run would skip, but listing fails so every byte re-uploads
      fake.failListKeys = true;
      // stale key that prune would delete if listing worked
      const staleKey = `${backupPrefix((await userRepo.findOneOrFail({ where: { id: user.id } })).email, user.id)}originals/stale.webp`;
      fake.objects.set(staleKey, Buffer.from('stale'));
      fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 1, uploaded: 1, skipped: 0 });
      expect(fake.ops.filter((o) => o.op === 'deleteKey')).toHaveLength(0);
      expect(fake.objects.has(staleKey)).toBe(true);
      fake.failListKeys = false;
    });

    it('auto-renames on email change with ~0 uploads and copy→manifest→delete order', async () => {
      const { user, seeded } = await seedUserWithFiles(2, 'rename');
      const oldEmail = user.email;
      const oldPrefix = backupPrefix(oldEmail, user.id);
      await runBackup(user.id);
      expect([...fake.objects.keys()].some((k) => k.startsWith(oldPrefix))).toBe(true);

      const newEmail = `renamed-${randomUUID()}@example.com`;
      await userRepo.update(user.id, { email: newEmail });
      const newPrefix = backupPrefix(newEmail, user.id);
      fake.ops = [];

      const second = await runBackup(user.id);
      expect(second.prefix).toBe(newPrefix);
      expect(second.uploaded).toBeLessThanOrEqual(1);
      expect(second.skipped).toBeGreaterThanOrEqual(1);
      expect(second.files).toBe(2);

      // old prefix gone, new prefix holds the bytes + fresh manifest
      expect([...fake.objects.keys()].some((k) => k.startsWith(oldPrefix))).toBe(false);
      expect([...fake.objects.keys()].filter((k) => k.startsWith(newPrefix))).toHaveLength(3);
      for (const f of seeded) {
        const expectedSuffix = `/originals/${f.record.id}.`;
        expect(
          [...fake.objects.keys()].some(
            (k) => k.startsWith(newPrefix) && k.includes(expectedSuffix),
          ),
        ).toBe(true);
      }

      // call order: copy-forward first, manifest next, old-prefix deletes last
      const copyIdx = fake.ops.findIndex((o) => o.op === 'copyKey');
      const manifestIdx = fake.ops.findIndex(
        (o) => o.op === 'putObject' && o.key.endsWith('manifest.json'),
      );
      const deleteIdx = fake.ops.findIndex((o) => o.op === 'deleteKey');
      expect(copyIdx).toBeGreaterThanOrEqual(0);
      expect(manifestIdx).toBeGreaterThan(copyIdx);
      expect(deleteIdx).toBeGreaterThan(manifestIdx);
      // empty prune: every delete targets the old prefix, none prunes the new one
      for (const op of fake.ops.filter((o) => o.op === 'deleteKey')) {
        expect(op.key.startsWith(oldPrefix)).toBe(true);
      }
    });
  });

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
      );
      await seedOriginal(u.id, Buffer.from(`overview-bytes-${email}`));
      const res = await runBackup(u.id);
      const manifestKey = `${res.prefix}manifest.json`;
      return { user: u, prefix: res.prefix, manifestKey };
    }

    async function deleteUserRowsKeepS3(userId: string): Promise<void> {
      await shareRepo.delete({ userId });
      await personRepo.delete({ userId });
      await assetRepo.delete({ userId });
      await fileRepo.delete({ userId });
      await albumRepo.delete({ userId });
      await userRepo.delete(userId);
    }

    it('unions live + orphan rows with deleted flags sorted by email', async () => {
      const liveEmail = `live-${randomUUID()}@example.com`;
      const live = await backupOneFile(liveEmail);
      const orphanEmail = `orphan-${randomUUID()}@example.com`;
      const orphan = await backupOneFile(orphanEmail);
      await deleteUserRowsKeepS3(orphan.user.id);

      const rows = await svc.backupOverview();
      const byId = new Map(rows.map((r) => [r.userId, r]));
      const liveRow = byId.get(live.user.id)!;
      expect(liveRow).toMatchObject({ email: liveEmail, deleted: false, exists: true });
      expect(liveRow.totalAssets).toBe(0);
      const orphanRow = byId.get(orphan.user.id)!;
      expect(orphanRow).toMatchObject({
        email: orphanEmail,
        deleted: true,
        exists: true,
        totalAssets: 0,
        notBackedUp: 0,
      });
      expect(orphanRow.backedUpFiles).toBe(1);
      expect(orphanRow.emailAtBackup).toBeUndefined();
      const emails = rows.map((r) => r.email);
      expect([...emails].sort()).toEqual(emails);
    });

    it('passes through corrupt/unreadable orphans and skips manifest-less prefixes', async () => {
      const corruptEmail = `corrupt-${randomUUID()}@example.com`;
      const corrupt = await backupOneFile(corruptEmail);
      fake.objects.set(corrupt.manifestKey, Buffer.from('not-json{{{'));
      await deleteUserRowsKeepS3(corrupt.user.id);

      const unreadEmail = `unread-${randomUUID()}@example.com`;
      const unread = await backupOneFile(unreadEmail);
      await deleteUserRowsKeepS3(unread.user.id);
      const unreadKey = unread.manifestKey;
      const origGet = fake.getBuffer.bind(fake);
      fake.getBuffer = (key: string) => {
        if (key === unreadKey) {
          const err = new Error('injected unreadable');
          err.name = 'InternalError';
          throw err;
        }
        return origGet(key);
      };

      const bareId = randomUUID();
      const barePrefix = backupPrefix(`bare-${randomUUID()}@example.com`, bareId);
      fake.objects.set(`${barePrefix}originals/stray.bin`, Buffer.from('stray'));

      try {
        const rows = await svc.backupOverview();
        const byId = new Map(rows.map((r) => [r.userId, r]));
        expect(byId.get(corrupt.user.id)).toMatchObject({
          deleted: true,
          exists: true,
          degraded: 'corrupt',
        });
        expect(byId.get(unread.user.id)).toMatchObject({
          deleted: true,
          exists: true,
          degraded: 'unreadable',
        });
        expect(byId.has(bareId)).toBe(false);
      } finally {
        fake.getBuffer = origGet;
      }
    });
  });

  describe('restore collisions (Phase 1)', () => {
    async function backupSingle(email: string): Promise<{ user: User; prefix: string }> {
      const u = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Collision User',
        }),
      );
      await seedOriginal(u.id, Buffer.from(`collision-bytes-${email}`));
      const res = await runBackup(u.id);
      return { user: u, prefix: res.prefix };
    }

    it('throws 409 already-restored when the same userId is live', async () => {
      const email = `sameid-${randomUUID()}@example.com`;
      const { user } = await backupSingle(email);
      const caught = await runRestore(user.id).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getStatus()).toBe(409);
      expect((caught as ConflictException).message).toContain('already-restored');
    });

    it('restores a gone user under the original id and email', async () => {
      const email = `gone-${randomUUID()}@example.com`;
      const { user, prefix } = await backupSingle(email);
      await dataSource.query(
        'TRUNCATE users, files, assets, albums, album_assets, shares, persons, backup_runs ' +
          'RESTART IDENTITY CASCADE',
      );
      rmSync(storageDir, { recursive: true, force: true });
      await storage.ensureDir();
      const result = await runRestore(user.id);
      expect(result.userId).toBe(user.id);
      expect(result.email).toBe(email);
      expect(result.prefix).toBe(prefix);
      expect(result.reassignmentError).toBeUndefined();
      expect(result.restoredFrom).toMatchObject({ emailAtBackup: email, prefix });
      expect(result.restoredFrom.manifestObjectKey.endsWith('manifest.json')).toBe(true);
      // same email: no re-home — the source prefix keeps its bytes + manifest
      const keptKeys = await fake.listKeys(prefix);
      expect(keptKeys.some((k) => k.endsWith('manifest.json'))).toBe(true);
      expect(keptKeys.length).toBe(2);
      const row = await userRepo.findOneOrFail({ where: { id: user.id } });
      expect(row.email).toBe(email);
    });

    it('falls back to restored-<ms>-<orig> when the email is taken by another id', async () => {
      const origEmail = `reuse-${randomUUID()}@example.com`;
      const { user: orig, prefix } = await backupSingle(origEmail);
      const origId = orig.id;
      await shareRepo.delete({ userId: origId });
      await personRepo.delete({ userId: origId });
      await assetRepo.delete({ userId: origId });
      await fileRepo.delete({ userId: origId });
      await userRepo.delete(origId);

      const other = await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Email Reuse',
        }),
      );
      expect(other.id).not.toBe(origId);

      const result = await runRestore(origId);
      expect(result.userId).toBe(origId);
      expect(result.email).not.toBe(origEmail);
      expect(result.email).toMatch(/^restored-\d+-.*@example\.com$/);
      expect(result.email).toContain(origEmail.split('@')[0]!.toLowerCase());
      // the snapshot is re-homed to the fallback address, restoredFrom keeps the source
      const restoredPrefix = backupPrefix(result.email, origId);
      expect(result.prefix).toBe(restoredPrefix);
      expect(result.reassignmentError).toBeUndefined();
      expect(result.restoredFrom.emailAtBackup).toBe(origEmail);
      expect(result.restoredFrom.prefix).toBe(prefix);

      const restored = await userRepo.findOneOrFail({ where: { id: origId } });
      expect(restored.email).toBe(result.email);
      const holder = await userRepo.findOneOrFail({ where: { id: other.id } });
      expect(holder.email).toBe(origEmail);

      // old prefix fully swept, new prefix carries the manifest + original bytes
      await expect(fake.listKeys(prefix)).resolves.toEqual([]);
      const file = await fileRepo.findOneOrFail({ where: { userId: origId } });
      const newKeys = await fake.listKeys(restoredPrefix);
      expect(newKeys).toEqual(
        expect.arrayContaining([
          manifestKey(result.email, origId),
          originalKey(result.email, origId, file.id, 'bin'),
        ]),
      );
      const rehomed = JSON.parse(
        (await fake.getBuffer(manifestKey(result.email, origId))).toString('utf-8'),
      ) as { userId: string; emailAtBackup: string; user: { id: string; email: string } };
      expect(rehomed.emailAtBackup).toBe(result.email);
      expect(rehomed.user.email).toBe(result.email);
      expect(rehomed.userId).toBe(origId);
      expect(rehomed.user.id).toBe(origId);

      await expect(svc.backupStatus(origId)).resolves.toMatchObject({
        exists: true,
        userId: origId,
        emailAtBackup: result.email,
      });
    });

    it('uses an explicit restoreEmail instead of the manifest/fallback allocation', async () => {
      const origEmail = `explicit-${randomUUID()}@example.com`;
      const { user: orig, prefix } = await backupSingle(origEmail);
      const origId = orig.id;
      await fileRepo.delete({ userId: origId });
      await userRepo.delete(origId);
      // manifest email reused by another live account: the default path would
      // allocate restored-<ms>-<orig>, but the explicit address must win instead
      const other = await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Email Reuse',
        }),
      );

      const requested = `requested-${randomUUID()}@example.com`;
      const result = await runRestore(origId, requested.toUpperCase());
      expect(result.userId).toBe(origId);
      expect(result.email).toBe(requested);
      // the snapshot was re-homed to the requested address; restoredFrom keeps the source
      const restoredPrefix = backupPrefix(requested, origId);
      expect(result.prefix).toBe(restoredPrefix);
      expect(result.reassignmentError).toBeUndefined();
      expect(result.restoredFrom).toMatchObject({ emailAtBackup: origEmail, prefix });
      const restored = await userRepo.findOneOrFail({ where: { id: origId } });
      expect(restored.email).toBe(requested);
      const holder = await userRepo.findOneOrFail({ where: { id: other.id } });
      expect(holder.email).toBe(origEmail);

      await expect(fake.listKeys(prefix)).resolves.toEqual([]);
      const file = await fileRepo.findOneOrFail({ where: { userId: origId } });
      const rehomed = JSON.parse(
        (await fake.getBuffer(manifestKey(requested, origId))).toString('utf-8'),
      ) as { userId: string; emailAtBackup: string; user: { id: string; email: string } };
      expect(rehomed.emailAtBackup).toBe(requested);
      expect(rehomed.user.email).toBe(requested);
      expect(rehomed.userId).toBe(origId);
      expect(rehomed.user.id).toBe(origId);
      expect(fake.objects.has(originalKey(requested, origId, file.id, 'bin'))).toBe(true);
    });

    it('keeps the source prefix and reports reassignmentError when re-home fails', async () => {
      const origEmail = `rehome-fail-${randomUUID()}@example.com`;
      const { user: orig, prefix } = await backupSingle(origEmail);
      const origId = orig.id;
      await shareRepo.delete({ userId: origId });
      await personRepo.delete({ userId: origId });
      await assetRepo.delete({ userId: origId });
      await fileRepo.delete({ userId: origId });
      await userRepo.delete(origId);

      await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Email Reuse',
        }),
      );

      fake.failNextCopies = 1;
      const result = await runRestore(origId);
      // the restore itself still succeeded under the fallback email
      expect(result.userId).toBe(origId);
      expect(result.email).toMatch(/^restored-\d+-.*@example\.com$/);
      expect(result.reassignmentError).toBe('injected copyKey failure');
      expect(result.prefix).toBe(prefix);
      expect(result.restoredFrom.prefix).toBe(prefix);
      const restored = await userRepo.findOneOrFail({ where: { id: origId } });
      expect(restored.email).toBe(result.email);
      // source prefix intact (bytes + manifest), nothing written under the fallback prefix
      const keptKeys = await fake.listKeys(prefix);
      expect(keptKeys.some((k) => k.endsWith('manifest.json'))).toBe(true);
      expect(keptKeys.length).toBe(2);
      await expect(fake.listKeys(backupPrefix(result.email, origId))).resolves.toEqual([]);
    });

    it('rejects an explicit restoreEmail owned by another live user (409 email-taken)', async () => {
      const origEmail = `taken-${randomUUID()}@example.com`;
      const { user: orig } = await backupSingle(origEmail);
      const origId = orig.id;
      await fileRepo.delete({ userId: origId });
      await userRepo.delete(origId);

      const holderEmail = `holder-${randomUUID()}@example.com`;
      const holder = await userRepo.save(
        userRepo.create({
          email: holderEmail,
          role: 'user',
          passwordHash: 'holder-hash',
          displayName: 'Holder',
        }),
      );

      const caught = await runRestore(origId, holderEmail.toUpperCase()).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getStatus()).toBe(409);
      expect((caught as ConflictException).message).toContain('email-taken');
      // restores nothing: no row/files for the backup user, holder unchanged
      expect(await userRepo.findOne({ where: { id: origId } })).toBeNull();
      expect(await fileRepo.findOne({ where: { userId: origId } })).toBeNull();
      const stillHolding = await userRepo.findOneOrFail({ where: { id: holder.id } });
      expect(stillHolding.email).toBe(holderEmail);
      await expect(svc.backupStatus(origEmail)).resolves.toMatchObject({ exists: true });
    });

    it('retries the fallback with a suffix when the first candidate is taken', async () => {
      const origEmail = `retry-${randomUUID()}@example.com`;
      const { user: orig } = await backupSingle(origEmail);
      const origId = orig.id;
      await assetRepo.delete({ userId: origId });
      await fileRepo.delete({ userId: origId });
      await userRepo.delete(origId);
      await userRepo.save(
        userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Reuse Holder',
        }),
      );

      const fixedNow = 1720000000000;
      const firstCandidate = buildFallbackEmail(origEmail, fixedNow, 0);
      await userRepo.save(
        userRepo.create({
          email: firstCandidate,
          role: 'user',
          passwordHash: 'blocker-hash',
          displayName: 'Fallback Blocker',
        }),
      );
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        const result = await runRestore(origId);
        expect(result.email).toBe(buildFallbackEmail(origEmail, fixedNow, 1));
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('double restore throws 409 already-restored', async () => {
      const email = `double-${randomUUID()}@example.com`;
      const { user } = await backupSingle(email);
      const origId = user.id;
      await dataSource.query(
        'TRUNCATE users, files, assets, albums, album_assets, shares, persons, backup_runs ' +
          'RESTART IDENTITY CASCADE',
      );
      rmSync(storageDir, { recursive: true, force: true });
      await storage.ensureDir();
      const first = await runRestore(origId);
      expect(first.userId).toBe(origId);
      const caught = await runRestore(origId).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).message).toContain('already-restored');
    });
  });

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
      );
      const seeded = await seedOriginal(u.id, Buffer.from(`delete-bytes-${email}`));
      const asset = await assetRepo.save(
        assetRepo.create({
          userId: u.id,
          kind: 'photo',
          fileId: seeded.record.id,
          isTrashed: false,
        }),
      );
      const res = await runBackup(u.id);
      expect(res.files).toBe(1);
      return { user: u, prefix: res.prefix, fileId: seeded.record.id, assetId: asset.id };
    }

    it('deletes a live user backup without touching DB rows, then re-backup works', async () => {
      const email = `delete-live-${randomUUID()}@example.com`;
      const { user, prefix, fileId, assetId } = await backupSingleFile(email);

      const deleted = await svc.deleteBackup(email);
      expect(deleted).toEqual({ userId: user.id, email, prefix, deletedObjects: 2 });

      // overview + status read exists:false while the rows stay live
      await expect(svc.backupStatus(email)).resolves.toEqual({ exists: false });
      const rows = await svc.backupOverview();
      expect(rows.find((r) => r.userId === user.id)).toMatchObject({
        email,
        deleted: false,
        exists: false,
      });
      await userRepo.findOneOrFail({ where: { id: user.id } });
      await fileRepo.findOneOrFail({ where: { id: fileId } });
      await assetRepo.findOneOrFail({ where: { id: assetId } });

      // next backup recreates the prefix from scratch
      const re = await runBackup(user.id);
      expect(re).toMatchObject({ userId: user.id, prefix, files: 1 });
      await expect(svc.backupStatus(email)).resolves.toMatchObject({ exists: true, files: 1 });
    });

    it('deletes an orphan backup by userId and drops it from the overview', async () => {
      const email = `delete-orphan-${randomUUID()}@example.com`;
      const { user, prefix } = await backupSingleFile(email);
      await shareRepo.delete({ userId: user.id });
      await personRepo.delete({ userId: user.id });
      await assetRepo.delete({ userId: user.id });
      await fileRepo.delete({ userId: user.id });
      await albumRepo.delete({ userId: user.id });
      await userRepo.delete(user.id);

      const deleted = await svc.deleteBackup(user.id);
      expect(deleted).toEqual({ userId: user.id, email, prefix, deletedObjects: 2 });
      await expect(fake.listKeys(prefix)).resolves.toEqual([]);
      expect([...fake.objects.keys()].some((k) => k.startsWith(prefix))).toBe(false);

      const rows = await svc.backupOverview();
      expect(rows.some((r) => r.userId === user.id)).toBe(false);
      await expect(svc.backupStatus(email)).resolves.toEqual({ exists: false });
    });

    it('throws 404 for unknown ids and emails', async () => {
      await expect(svc.deleteBackup(randomUUID())).rejects.toThrow(NotFoundException);
      await expect(svc.deleteBackup(`ghost-${randomUUID()}@example.com`)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('merge backups', () => {
    /** Rows only — the account itself stays live (a stale snapshot over a live user). */
    async function deleteOwnedRows(userId: string): Promise<void> {
      const albums = await albumRepo.find({ where: { userId } });
      if (albums.length > 0) {
        await albumAssetRepo.delete({ albumId: In(albums.map((album) => album.id)) });
      }
      await shareRepo.delete({ userId });
      await personRepo.delete({ userId });
      await assetRepo.delete({ userId });
      await fileRepo.delete({ userId });
      await albumRepo.delete({ userId });
    }

    async function deleteAccountRows(userId: string): Promise<void> {
      await deleteOwnedRows(userId);
      await userRepo.delete(userId);
    }

    async function seedAccount(email: string): Promise<{
      user: User;
      file: FileRecord;
      bytes: Buffer;
      asset: Asset;
      album: Album;
      share: Share;
      person: Person;
    }> {
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'legacy-hash',
          displayName: 'Legacy User',
        }),
      );
      const seeded = await seedOriginal(user.id, Buffer.from(`merge-bytes-${email}`), {
        mimeType: 'image/png',
        originalName: 'merge.png',
      });
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
      );
      const album = await albumRepo.save(
        albumRepo.create({
          userId: user.id,
          name: 'Legacy Trip',
          description: 'old album',
          hiddenFromTimeline: true,
        }),
      );
      await albumAssetRepo.save(albumAssetRepo.create({ albumId: album.id, assetId: asset.id }));
      const share = await shareRepo.save(
        shareRepo.create({
          userId: user.id,
          kind: 'asset',
          assetId: asset.id,
          albumId: null,
          token: createHash('sha256').update(randomUUID()).digest('hex'),
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        }),
      );
      const person = await personRepo.save(
        personRepo.create({
          userId: user.id,
          name: 'Mom',
          coverFaceId: randomUUID(),
          clusterLabel: 'c1',
          faceCount: 5,
        }),
      );
      return { user, file: seeded.record, bytes: seeded.bytes, asset, album, share, person };
    }

    it('merges a matched legacy snapshot, adopts it into the live prefix and removes the source', async () => {
      const email = `merge-${randomUUID()}@example.com`;
      const legacy = await seedAccount(email);
      const legacyBackup = await runBackup(legacy.user.id);
      const legacyPrefix = legacyBackup.prefix;
      const legacyId = legacy.user.id;
      await deleteAccountRows(legacyId);

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target Profile',
        }),
      );
      const result = await svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: legacyId,
      });
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
      });
      expect(result.adoptionError).toBeUndefined();
      expect(result.assigned).toMatchObject({
        prefix: backupPrefix(email, target.id),
        copiedObjects: 1,
        reusedObjects: 0,
        unionedWithExisting: false,
        sourceDeleted: true,
      });
      expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result.startedAt).getTime(),
      );
      expect(result.enqueued).toEqual({ metadata: 1, thumbnails: 4, videos: 0, faces: 1, ai: 2 });

      // live profile untouched
      const after = await userRepo.findOneOrFail({ where: { id: target.id } });
      expect(after).toMatchObject({
        email,
        role: 'user',
        passwordHash: 'target-hash',
        displayName: 'Target Profile',
        tokensValidAfter: null,
      });

      // old UUIDs re-created under the target; bytes live under the target namespace
      const fileAfter = await fileRepo.findOneOrFail({ where: { id: legacy.file.id } });
      expect(fileAfter.userId).toBe(target.id);
      expect(fileAfter.storageKey.startsWith(`originals/${target.id}/`)).toBe(true);
      expect(await readFile(storage.pathFor(fileAfter.storageKey))).toEqual(legacy.bytes);
      const assetAfter = await assetRepo.findOneOrFail({ where: { id: legacy.asset.id } });
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
      });
      const albumAfter = await albumRepo.findOneOrFail({ where: { id: legacy.album.id } });
      expect(albumAfter.userId).toBe(target.id);
      expect(albumAfter.hiddenFromTimeline).toBe(true);
      await albumAssetRepo.findOneOrFail({
        where: { albumId: legacy.album.id, assetId: legacy.asset.id },
      });
      const shareAfter = await shareRepo.findOneOrFail({ where: { id: legacy.share.id } });
      expect(shareAfter).toMatchObject({ userId: target.id, assetId: legacy.asset.id });
      expect(shareAfter.expiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));
      const personAfter = await personRepo.findOneOrFail({ where: { id: legacy.person.id } });
      expect(personAfter).toMatchObject({
        userId: target.id,
        name: 'Mom',
        clusterLabel: 'c1',
        faceCount: 5,
        coverFaceId: null,
      });

      // adoption moved the snapshot into the target's own prefix and deleted the
      // source: no legacyBackups sub-row material remains
      const targetPrefix = backupPrefix(email, target.id);
      expect(result.assigned!.prefix).toBe(targetPrefix);
      await expect(fake.listKeys(legacyPrefix)).resolves.toEqual([]);
      const targetKeys = await fake.listKeys(targetPrefix);
      expect(targetKeys).toHaveLength(2);
      expect(targetKeys).toEqual(
        expect.arrayContaining([
          manifestKey(email, target.id),
          originalKey(email, target.id, legacy.file.id, 'bin'),
        ]),
      );

      const targetManifest = JSON.parse(
        (await fake.getBuffer(manifestKey(email, target.id))).toString('utf-8'),
      ) as UserBackupManifest;
      expect(targetManifest).toMatchObject({
        userId: target.id,
        emailAtBackup: email,
        user: { id: target.id, passwordHash: 'target-hash' },
      });
      // adoption reuses the source snapshot's backedUpAt — same content, one run
      expect(targetManifest.backedUpAt).toBe(legacyBackup.backedUpAt);
      expect(targetManifest.files).toHaveLength(1);
      expect(targetManifest.assets).toHaveLength(1);
      expect(targetManifest.albums).toHaveLength(1);
      expect(targetManifest.albumAssets).toHaveLength(1);
      expect(targetManifest.shares).toHaveLength(1);
      expect(targetManifest.persons).toHaveLength(1);
      expect(targetManifest.files[0]).toMatchObject({
        userId: target.id,
        assetId: legacy.asset.id,
      });
      expect(targetManifest.assets[0]!.userId).toBe(target.id);
      // every manifest entry has its original bytes under the target prefix
      for (const entry of targetManifest.files) {
        const ext = entry.storageKey.slice(entry.storageKey.lastIndexOf('.') + 1);
        expect(fake.objects.has(originalKey(email, target.id, entry.id, ext))).toBe(true);
      }

      // durable ledger
      const ledger = await mergeRepo.findOneOrFail({
        where: { backupUserId: legacyId, targetUserId: target.id },
      });
      expect(ledger.prefix).toBe(legacyPrefix);
      expect(ledger.counts).toMatchObject({ files: 1, assets: 1 });

      // the live row is now the normal backup: its own manifest at the target
      // prefix, no previous-account sub-row and no mergedAt/backupUserId extras
      const row = (await svc.backupOverview()).find((r) => r.userId === target.id)!;
      expect(row).toMatchObject({
        deleted: false,
        exists: true,
        totalAssets: 1,
        backedUpAssets: 1,
        backedUpFiles: 1,
      });
      // live rows never carry prefix/legacyBackups — only orphans and snapshot
      // sub-rows do; the adopted backup is the live row itself
      expect(row.prefix).toBeUndefined();
      expect(row.legacyBackups).toBeUndefined();
      await expect(svc.backupStatus(email)).resolves.toMatchObject({ exists: true, files: 1 });

      // the adopted manifest is a valid incremental predecessor: a rerun re-uploads
      // nothing
      const nextBackup = await runBackup(target.id);
      expect(nextBackup).toMatchObject({ uploaded: 0, skipped: 1 });

      const metadataJobs = await queueJobsFor('process-metadata', target.id);
      expect(metadataJobs.map((data) => data.assetId)).toContain(legacy.asset.id);
    }, 120_000);

    // Same contract as the restore path: a refused add must fail the request, not return
    // counts for jobs that were never created.
    it('fails the merge when a derivative enqueue is refused instead of claiming it', async () => {
      const email = `merge-enqueue-${randomUUID()}@example.com`;
      const legacy = await seedAccount(email);
      await runBackup(legacy.user.id);
      const legacyId = legacy.user.id;
      await deleteAccountRows(legacyId);
      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target',
        }),
      );

      const realEnqueue = bullMq.enqueue.bind(bullMq);
      const spy = vi
        .spyOn(bullMq, 'enqueue')
        .mockImplementation((queue, jobName, data, opts) =>
          queue === 'process-metadata'
            ? Promise.resolve(false)
            : realEnqueue(queue, jobName, data, opts),
        );
      try {
        await expect(
          svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacyId }),
        ).rejects.toThrow(ServiceUnavailableException);
      } finally {
        spy.mockRestore();
      }

      // the ledger lands after the derivatives, so nothing claims the merge and the
      // documented plain retry is still allowed
      expect(
        await mergeRepo.findOne({ where: { backupUserId: legacyId, targetUserId: target.id } }),
      ).toBeNull();
      expect(await queueJobsFor('process-metadata', target.id)).toHaveLength(0);
    });

    it('recovers from a failed adoption with a retry that replays the merge', async () => {
      const email = `merge-retry-${randomUUID()}@example.com`;
      const legacy = await seedAccount(email);
      const legacyPrefix = (await runBackup(legacy.user.id)).prefix;
      const legacyId = legacy.user.id;
      await deleteAccountRows(legacyId);

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Retry Target',
        }),
      );

      // Rows/bytes land, then adoption's S3 copy fails: no ledger, source kept, so
      // a plain retry is still allowed.
      fake.failNextCopies = 1;
      const failed = await svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: legacyId,
      });
      expect(failed.assigned).toBeNull();
      expect(failed.adoptionError).toContain('injected copyKey failure');
      expect((await fake.listKeys(legacyPrefix)).length).toBeGreaterThan(0);
      expect(
        await mergeRepo.findOne({
          where: { backupUserId: legacyId, targetUserId: target.id },
        }),
      ).toBeNull();

      // The retry finds the already-merged rows (skipped), re-enqueues their
      // derivatives, adopts the source and removes it.
      const retry = await svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: legacyId,
        force: true,
      });
      expect(retry.skipped.assets).toBe(1);
      expect(retry.enqueued).toEqual({ metadata: 1, thumbnails: 4, videos: 0, faces: 1, ai: 2 });
      expect(retry.assigned).toMatchObject({
        prefix: backupPrefix(email, target.id),
        sourceDeleted: true,
      });
      await expect(fake.listKeys(legacyPrefix)).resolves.toEqual([]);
    }, 120_000);

    it('dedupes identical originals and relinks album/share targets to the live asset', async () => {
      const email = `merge-dedupe-${randomUUID()}@example.com`;
      const bytes = Buffer.from('merge-dedupe-shared-bytes');
      const legacyUser = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'legacy-hash',
          displayName: 'Legacy Dedupe',
        }),
      );
      const legacyFile = await seedOriginal(legacyUser.id, bytes);
      const legacyAsset = await assetRepo.save(
        assetRepo.create({ userId: legacyUser.id, kind: 'photo', fileId: legacyFile.record.id }),
      );
      const legacyAlbum = await albumRepo.save(
        albumRepo.create({ userId: legacyUser.id, name: 'Dedupe Album', description: null }),
      );
      await albumAssetRepo.save(
        albumAssetRepo.create({ albumId: legacyAlbum.id, assetId: legacyAsset.id }),
      );
      const legacyShare = await shareRepo.save(
        shareRepo.create({
          userId: legacyUser.id,
          kind: 'asset',
          assetId: legacyAsset.id,
          albumId: null,
          token: createHash('sha256').update(randomUUID()).digest('hex'),
          expiresAt: null,
        }),
      );
      await runBackup(legacyUser.id);
      await deleteAccountRows(legacyUser.id);

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target Dedupe',
        }),
      );
      const targetFile = await seedOriginal(target.id, bytes);
      const targetAsset = await assetRepo.save(
        assetRepo.create({ userId: target.id, kind: 'photo', fileId: targetFile.record.id }),
      );

      const result = await svc.mergeUserBackup({
        targetEmailOrId: email,
        backupUserId: legacyUser.id,
      });
      expect(result.deduped).toEqual({ files: 1, assets: 1 });
      expect(result.merged).toMatchObject({ files: 0, assets: 0, albums: 1, shares: 1 });
      expect(await assetRepo.findOne({ where: { id: legacyAsset.id } })).toBeNull();
      expect(await fileRepo.findOne({ where: { id: legacyFile.record.id } })).toBeNull();
      await albumAssetRepo.findOneOrFail({
        where: { albumId: legacyAlbum.id, assetId: targetAsset.id },
      });
      const shareAfter = await shareRepo.findOneOrFail({ where: { id: legacyShare.id } });
      expect(shareAfter).toMatchObject({ userId: target.id, assetId: targetAsset.id });
      expect(result.assigned).toMatchObject({
        prefix: backupPrefix(email, target.id),
        copiedObjects: 1,
        reusedObjects: 0,
        unionedWithExisting: false,
        sourceDeleted: true,
      });
      // the adopted manifest references the live rows the merge relinked to, never
      // the deduped legacy ids
      const targetManifest = JSON.parse(
        (await fake.getBuffer(manifestKey(email, target.id))).toString('utf-8'),
      ) as UserBackupManifest;
      expect(targetManifest.files.map((file) => file.id)).toEqual([targetFile.record.id]);
      expect(targetManifest.assets.map((asset) => asset.id)).toEqual([targetAsset.id]);
      expect(targetManifest.files.some((file) => file.id === legacyFile.record.id)).toBe(false);
      expect(targetManifest.assets.some((asset) => asset.id === legacyAsset.id)).toBe(false);
      // the source copy is gone; the single remaining original lives under the
      // target prefix under the live file id
      expect([...fake.objects.keys()].filter((key) => key.includes('/originals/'))).toEqual([
        originalKey(email, target.id, targetFile.record.id, 'bin'),
      ]);
      expect(result.enqueued).toEqual({ metadata: 0, thumbnails: 0, videos: 0, faces: 0, ai: 0 });
    }, 120_000);

    it('rejects an email mismatch, a second merge and a missing source', async () => {
      const email = `merge-conflict-${randomUUID()}@example.com`;
      const legacy = await seedAccount(email);
      await runBackup(legacy.user.id);
      await deleteAccountRows(legacy.user.id);

      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Conflict Target',
        }),
      );
      const other = await userRepo.save(
        userRepo.create({
          email: `other-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Other',
        }),
      );

      // Mismatch runs before the successful merge: adoption deletes the source, so
      // the email check must see the snapshot while it still exists.
      const mismatch = await svc
        .mergeUserBackup({ targetEmailOrId: other.id, backupUserId: legacy.user.id, force: true })
        .catch((err: unknown) => err);
      expect(mismatch).toBeInstanceOf(ConflictException);
      expect((mismatch as ConflictException).message).toContain('email-mismatch');

      await svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id });

      // The ledger check runs before source resolution: the source is gone now, but
      // a plain repeat must still answer 409 already-merged instead of 404.
      const second = await svc
        .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id })
        .catch((err: unknown) => err);
      expect(second).toBeInstanceOf(ConflictException);
      expect((second as ConflictException).message).toContain('already-merged');

      await expect(
        svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: randomUUID() }),
      ).rejects.toThrow(NotFoundException);
    }, 120_000);

    it('enforces STORAGE_QUOTA_BYTES on incoming bytes unless force is set', async () => {
      const previous = process.env.STORAGE_QUOTA_BYTES;
      process.env.STORAGE_QUOTA_BYTES = '8';
      try {
        const email = `merge-quota-${randomUUID()}@example.com`;
        const legacy = await seedAccount(email);
        const legacyPrefix = (await runBackup(legacy.user.id)).prefix;
        await deleteAccountRows(legacy.user.id);
        const target = await userRepo.save(
          userRepo.create({
            email,
            role: 'user',
            passwordHash: 'target-hash',
            displayName: 'Quota Target',
          }),
        );

        const rejected = await svc
          .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id })
          .catch((err: unknown) => err);
        expect(rejected).toBeInstanceOf(PayloadTooLargeException);
        expect((rejected as Error).message).toMatch(/used \d+ \+ incoming \d+ > quota 8/);

        const forced = await svc.mergeUserBackup({
          targetEmailOrId: target.id,
          backupUserId: legacy.user.id,
          force: true,
        });
        expect(forced.merged.files).toBe(1);
        expect(forced.assigned).toMatchObject({
          prefix: backupPrefix(email, target.id),
          sourceDeleted: true,
        });
        await expect(fake.listKeys(legacyPrefix)).resolves.toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.STORAGE_QUOTA_BYTES;
        else process.env.STORAGE_QUOTA_BYTES = previous;
      }
    }, 120_000);

    it('refuses to merge a snapshot whose source account is still live', async () => {
      const email = `merge-live-${randomUUID()}@example.com`;
      const source = await seedAccount(email);
      const snapshot = await runBackup(source.user.id);
      // The account deleted those photos and never backed up again, so the snapshot's
      // ids are gone from the DB — only the prefix and its emailAtBackup remain. That
      // is what lets the merge get past the global id-conflict check.
      await deleteOwnedRows(source.user.id);
      await userRepo.update(source.user.id, {
        email: `merge-live-moved-${randomUUID()}@example.com`,
      });
      // Another account registers the freed address: the manifest label now matches it.
      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Live Source Target',
        }),
      );

      const keysBefore = [...fake.objects.keys()].sort();
      const err = await svc
        .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: source.user.id })
        .catch((e: unknown) => e);

      expect(snapshot.prefix).toBe(backupPrefix(email, source.user.id));
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toContain('source-alive');
      // Nothing adopted into the target and no backup bytes deleted: the live account
      // keeps the snapshot the merge was about to take from it.
      expect([...fake.objects.keys()].sort()).toEqual(keysBefore);
      expect(await assetRepo.count({ where: { userId: target.id } })).toBe(0);
      expect(await assetRepo.count({ where: { userId: source.user.id } })).toBe(0);
    }, 120_000);

    it('deletes only the merged prefix, not another backup of the same account id', async () => {
      const email = `merge-scope-${randomUUID()}@example.com`;
      const source = await seedAccount(email);
      const mergedPrefix = (await runBackup(source.user.id)).prefix;

      // The account changes its address and backs up again. The old prefix's clean-up
      // fails here, so one account id ends up with two prefixes — the state a failed
      // rename/delete leaves behind in production.
      await userRepo.update(source.user.id, {
        email: `merge-scope-moved-${randomUUID()}@example.com`,
      });
      const realDelete = fake.deleteKeys.bind(fake);
      const deleteSpy = vi
        .spyOn(fake, 'deleteKeys')
        .mockImplementation(async (keys: string[]): Promise<void> => {
          if (keys.some((key) => key.startsWith(mergedPrefix))) {
            throw new Error('injected delete failure');
          }
          return realDelete(keys);
        });
      const keptPrefix = (await runBackup(source.user.id)).prefix;
      deleteSpy.mockRestore();

      expect(keptPrefix).not.toBe(mergedPrefix);
      expect(await fake.listKeys(mergedPrefix)).not.toEqual([]);
      expect(await fake.listKeys(keptPrefix)).not.toEqual([]);
      const keptKeysBefore = (await fake.listKeys(keptPrefix)).sort();

      // Rows gone, so the snapshot's ids no longer collide with a live owner.
      await deleteAccountRows(source.user.id);
      const target = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Scope Target',
        }),
      );

      // Merge the snapshot by its explicit prefix: the newest prefix is the other one,
      // and deleting the source by account id takes both.
      await svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: source.user.id,
        prefix: mergedPrefix,
      });

      await expect(fake.listKeys(mergedPrefix)).resolves.toEqual([]);
      expect((await fake.listKeys(keptPrefix)).sort()).toEqual(keptKeysBefore);
    }, 120_000);
  });

  it('reports a non-terminal run on the overview row so a reload can resume progress', async () => {
    const email = `active-run-${randomUUID()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Active Run',
      }),
    );
    await seedOriginal(user.id, Buffer.from('active-run-bytes'));

    const { runId } = await svc.startBackup(user.id);
    const row = (await svc.backupOverview()).find((entry) => entry.userId === user.id);
    expect(row?.activeRun).toEqual({ id: runId, kind: 'backup', state: 'running' });

    // the overview's activeRun is a projection of a non-terminal run row, not of cancel
    await dataSource.getRepository(BackupRun).update(runId, {
      state: 'cancelled',
      currentFile: null,
      finishedAt: new Date(),
    });
    const after = (await svc.backupOverview()).find((entry) => entry.userId === user.id);
    expect(after?.activeRun).toBeUndefined();
  }, 120_000);

  describe('queued transfers', () => {
    beforeEach(async () => {
      await bullMq.redis.flushdb();
    });

    async function takeJob(queueName: string): Promise<TransferJobData> {
      const jobs = await bullMq.getQueue(queueName).getJobs(['waiting', 'delayed']);
      expect(jobs).toHaveLength(1);
      const job = jobs[0]!;
      await job.remove();
      return job.data as TransferJobData;
    }

    async function queuedItemCount(runId: string): Promise<number> {
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM backup_run_items WHERE "runId" = $1',
        [runId],
      );
      return rows[0]?.count ?? 0;
    }

    it('dispatches a backup item to the backup queue and consumes it to completion', async () => {
      const email = `queue-backup-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Backup',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-backup-bytes'));

      const photo = await fileRepo.findOneOrFail({ where: { userId: user.id } });
      const { runId } = await svc.startBackup(user.id);
      expect(await svc.dispatchPendingTransfers('backup', 10)).toBe(1);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);
      expect(await bullMq.getQueue(RESTORE_TRANSFER_QUEUE).getJobs(['waiting'])).toHaveLength(0);

      await svc.consumeTransferJob('backup', { data, attemptsMade: 0, opts: { attempts: 5 } });

      expect((await svc.getRunStatus(runId)).state).toBe('completed');
      expect(await queuedItemCount(runId)).toBe(0);
      const key = originalKey(email, user.id, photo.id, 'bin');
      expect(fake.objects.has(key)).toBe(true);
    });

    it('dispatches a restore to the restore queue only and restores the bytes', async () => {
      const email = `queue-restore-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Restore',
        }),
      );
      const photo = await seedOriginal(user.id, Buffer.from('queue-restore-bytes'));
      await runBackup(user.id);
      await wipeUserData();

      const { runId } = await svc.startRestore(user.id);
      expect(await svc.dispatchPendingTransfers('restore', 10)).toBe(1);
      const data = await takeJob(RESTORE_TRANSFER_QUEUE);
      expect(await bullMq.getQueue(BACKUP_TRANSFER_QUEUE).getJobs(['waiting'])).toHaveLength(0);

      await svc.consumeTransferJob('restore', { data, attemptsMade: 0, opts: { attempts: 5 } });

      expect((await svc.getRunStatus(runId)).state).toBe('completed');
      const restored = await fileRepo.findOneOrFail({ where: { id: photo.record.id } });
      expect(await readFile(storage.pathFor(restored.storageKey))).toEqual(photo.bytes);
    });

    it('ignores a job delivered to the wrong queue', async () => {
      const user = await userRepo.save(
        userRepo.create({
          email: `queue-wrong-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Wrong',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-wrong-bytes'));
      const { runId } = await svc.startBackup(user.id);
      await svc.dispatchPendingTransfers('backup', 10);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);

      await svc.consumeTransferJob('restore', { data, attemptsMade: 0, opts: { attempts: 5 } });

      expect(await queuedItemCount(runId)).toBe(1);
      expect((await svc.getRunStatus(runId)).state).toBe('running');
    });

    it('retries a transient failure through the queue and finishes on the second attempt', async () => {
      const user = await userRepo.save(
        userRepo.create({
          email: `queue-retry-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Retry',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-retry-bytes'));
      const { runId } = await svc.startBackup(user.id);
      await svc.dispatchPendingTransfers('backup', 10);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);

      fake.failNextPuts = 1;
      await expect(
        svc.consumeTransferJob('backup', { data, attemptsMade: 0, opts: { attempts: 5 } }),
      ).rejects.toThrow('injected putFile failure');
      const queued = await dataSource.query<{ state: string }[]>(
        'SELECT "state" FROM backup_run_items WHERE "id" = $1',
        [data.itemId],
      );
      expect(queued[0]?.state).toBe('queued');

      await svc.consumeTransferJob('backup', { data, attemptsMade: 1, opts: { attempts: 5 } });
      expect((await svc.getRunStatus(runId)).state).toBe('completed');
    });

    it('pauses the run on a local disk failure without retrying the job', async () => {
      const email = `queue-disk-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Disk',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-disk-bytes'));
      await runBackup(user.id);
      await wipeUserData();
      const { runId } = await svc.startRestore(user.id);
      await svc.dispatchPendingTransfers('restore', 10);
      const data = await takeJob(RESTORE_TRANSFER_QUEUE);

      const noSpace = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      const save = vi.spyOn(storage, 'save').mockRejectedValueOnce(noSpace);
      try {
        await svc.consumeTransferJob('restore', { data, attemptsMade: 0, opts: { attempts: 5 } });
      } finally {
        save.mockRestore();
      }

      expect((await svc.getRunStatus(runId)).state).toBe('paused');
      expect(await queuedItemCount(runId)).toBe(1);
    });
  });

  // Two POSTs (double click, two tabs, an auto-retry) both pass `assertNoActiveRun`, a plain
  // findOne with no lock or unique rule behind it, and then write into the same fixed prefix.
  describe('concurrent starts for one user (fails first)', () => {
    it('accepts exactly one of two simultaneous starts', async () => {
      const email = `race-start-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Race Start',
        }),
      );
      await seedOriginal(user.id, Buffer.from('race-start-bytes'));

      // launched in the same tick: both read "no active run" before either inserts
      const settled = await Promise.allSettled([
        svc.startBackup(user.id),
        svc.startBackup(user.id),
      ]);

      const refused = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const activeRuns = await dataSource.getRepository(BackupRun).count({
        where: { userId: user.id, state: In(['running', 'paused', 'finalizing']) },
      });

      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.reason).toBeInstanceOf(ConflictException);
      expect(activeRuns).toBe(1);
    });

    it('does not prune bytes uploaded for a file created after its snapshot', async () => {
      const email = `race-prune-${randomUUID()}@example.com`;
      const user = await userRepo.save(
        userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Race Prune',
        }),
      );
      const a = await seedOriginal(user.id, Buffer.from('race-prune-a'));
      await assetRepo.save(
        assetRepo.create({ userId: user.id, kind: 'photo', fileId: a.record.id, isTrashed: false }),
      );

      const { runId } = await svc.startBackup(user.id);
      expect((await svc.getRunStatus(runId)).state).toBe('running');

      // The second start uploads a new file into the same prefix after the first run took
      // its file list. The prune compares S3 against that frozen snapshot, not the DB.
      const b = await seedOriginal(user.id, Buffer.from('race-prune-b'));
      await assetRepo.save(
        assetRepo.create({ userId: user.id, kind: 'photo', fileId: b.record.id, isTrashed: false }),
      );
      const keyB = originalKey(email, user.id, b.record.id, 'bin');
      await fake.putObject(keyB, Buffer.from('race-prune-b'));

      for (let i = 0; i < 20; i++) {
        if ((await svc.getRunStatus(runId)).state !== 'running') break;
        await svc.runTransfersOnce();
      }
      expect((await svc.getRunStatus(runId)).state).toBe('completed');

      // b has a live file row, so its bytes belong to the user: the prune must not delete them
      expect(fake.objects.has(keyB)).toBe(true);
    });
  });
});
