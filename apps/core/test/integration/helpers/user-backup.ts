import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { vi } from 'vitest';
import { LocalStorageService } from '@photox/shared-config';
import { DataSource, type Repository } from 'typeorm';
import { Asset, FileRecord, Person } from '../../../src/database/entities';
import { Album } from '../../../src/database/entities/album.entity';
import { AlbumAsset } from '../../../src/database/entities/album-asset.entity';
import { Share } from '../../../src/database/entities/share.entity';
import { User } from '../../../src/database/entities/user.entity';
import { BackupModule } from '../../../src/backup/backup.module';
import { BackupMerge } from '../../../src/database/entities/backup-merge.entity';
import { BackupRun } from '../../../src/database/entities/backup-run.entity';
import { S3BackupService } from '../../../src/backup/s3-backup.service';
import {
  UserBackupService,
  type BackupResult,
  type RestoreResult,
} from '../../../src/backup/user-backup.service';
import type { BackupRunStatus } from '../../../src/backup/backup.types';
import { BullMqModule } from '../../../src/queue/bullmq.module';
import { BullMqService } from '../../../src/queue/bullmq.service';
import { resetDb, type ApiTestApp } from '../helpers';
import { setupTestInfra, teardownTestInfra } from '../test-setup';
import { ENTITIES } from '../entities';

export interface FakeOp {
  op: 'putObject' | 'putFile' | 'deleteKey' | 'copyKey';
  key: string;
}

/**
 * In-memory S3BackupService stand-in — backup specs never need Floci/docker.
 * Records put order so M3 (bytes first, manifest last) is assertable, and can
 * inject a mid-run putFile failure for the rerun-after-failure case.
 */
export class FakeS3BackupService {
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

export interface BackupTestApp {
  app: INestApplication;
  dataSource: DataSource;
  storage: LocalStorageService;
  storageDir: string;
  svc: UserBackupService;
  bullMq: BullMqService;
  fake: FakeS3BackupService;
  userRepo: Repository<User>;
  fileRepo: Repository<FileRecord>;
  assetRepo: Repository<Asset>;
  albumRepo: Repository<Album>;
  albumAssetRepo: Repository<AlbumAsset>;
  shareRepo: Repository<Share>;
  personRepo: Repository<Person>;
  mergeRepo: Repository<BackupMerge>;
}

/**
 * The app these helpers act on, assigned by `createBackupTestApp`. Each spec file boots its
 * own app (vitest isolates modules per file), so one binding per module is enough; it keeps the
 * moved test bodies reading as they did when everything lived in one file.
 */
/**
 * The per-file live binding each spec reads. Correct only because vitest gives every spec
 * file its own module registry (`isolate: true`); a spec file must boot once, never twice.
 */
export let t: BackupTestApp;

let prevStorageDir: string | undefined;

/** Boots only BullMq + Backup: these specs exercise the ledger/services, never HTTP. */
export async function createBackupTestApp(): Promise<BackupTestApp> {
  const { pgHost, pgPort, pgDb } = await setupTestInfra();
  const storageDir = mkdtempSync(join(tmpdir(), 'backup-int-storage-'));
  prevStorageDir = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storageDir;
  const fake = new FakeS3BackupService();
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
    const app = moduleRef.createNestApplication();
    await app.init();
    t = {
      app,
      dataSource: app.get<DataSource>(DataSource),
      storage: app.get<LocalStorageService>(LocalStorageService),
      storageDir,
      svc: app.get<UserBackupService>(UserBackupService),
      bullMq: app.get<BullMqService>(BullMqService),
      fake,
      userRepo: app.get<Repository<User>>(getRepositoryToken(User)),
      fileRepo: app.get<Repository<FileRecord>>(getRepositoryToken(FileRecord)),
      assetRepo: app.get<Repository<Asset>>(getRepositoryToken(Asset)),
      albumRepo: app.get<Repository<Album>>(getRepositoryToken(Album)),
      albumAssetRepo: app.get<Repository<AlbumAsset>>(getRepositoryToken(AlbumAsset)),
      shareRepo: app.get<Repository<Share>>(getRepositoryToken(Share)),
      personRepo: app.get<Repository<Person>>(getRepositoryToken(Person)),
      mergeRepo: app.get<Repository<BackupMerge>>(getRepositoryToken(BackupMerge)),
    };
    return t;
  } catch (err) {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = prevStorageDir;
    throw err;
  }
}

export async function closeBackupTestApp(): Promise<void> {
  await t.app.close();
  if (prevStorageDir === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = prevStorageDir;
  await teardownTestInfra();
  rmSync(t.storageDir, { recursive: true, force: true });
}

/** Rows, bytes and the fake's counters: the one reset every spec file shares. */
export async function resetBackupDb(): Promise<void> {
  // resetDb derives its TRUNCATE list from the registered entities
  await resetDb(t as unknown as ApiTestApp);
  t.fake.objects.clear();
  t.fake.ops = [];
  t.fake.failNextPuts = 0;
  t.fake.putAttempts = 0;
  t.fake.failNextDownloads = 0;
  t.fake.failNextCopies = 0;
  t.fake.failListKeys = false;
}

/**
 * Deletes the account rows the real wipe would delete, including its durable ledger (a
 * backup run is metadata about the account; a merge row whose *target* is gone cannot survive
 * the users FK — but a merge row that names this account as its *source* must, that reference
 * is deliberately unconstrained).
 */
export async function deleteAccountRow(userId: string): Promise<void> {
  await t.dataSource.getRepository(BackupRun).delete({ userId });
  await t.mergeRepo.delete({ targetUserId: userId });
  await t.userRepo.delete(userId);
}

export async function seedOriginal(
  userId: string,
  bytes: Buffer,
  opts?: { mimeType?: string; originalName?: string },
): Promise<{ record: FileRecord; bytes: Buffer }> {
  const storageKey = `originals/${userId}/${randomUUID()}.bin`;
  await mkdir(dirname(t.storage.pathFor(storageKey)), { recursive: true });
  await writeFile(t.storage.pathFor(storageKey), bytes);
  const record = await t.fileRepo.save(
    t.fileRepo.create({
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

export async function seedFile(
  userId: string,
  storageKey: string,
  bytes: Buffer,
  opts?: { mimeType?: string; originalName?: string; purpose?: 'original' | 'transcode' },
): Promise<FileRecord> {
  await mkdir(dirname(t.storage.pathFor(storageKey)), { recursive: true });
  await writeFile(t.storage.pathFor(storageKey), bytes);
  return t.fileRepo.save(
    t.fileRepo.create({
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

/** Mid-test wipe: rows and bytes go, the fake's S3 snapshot stays (a restore needs it). */
export async function wipeUserData(): Promise<void> {
  await resetDb(t as unknown as ApiTestApp);
}

export function expectManifestLast(): void {
  const manifestIdx = t.fake.ops.findIndex((o) => o.key.endsWith('manifest.json'));
  expect(manifestIdx).toBeGreaterThan(-1);
  const byteOps = t.fake.ops.filter((o) => o.op === 'putFile');
  expect(byteOps.length).toBeGreaterThan(0);
  for (const op of byteOps) {
    expect(t.fake.ops.indexOf(op)).toBeLessThan(manifestIdx);
  }
}

export async function queueJobsFor(queueName: string, userId: string): Promise<JobData[]> {
  const jobs = await t.bullMq.getQueue(queueName).getJobs(['waiting', 'delayed', 'active']);
  return jobs.map((j) => j.data as JobData).filter((d) => d.userId === userId);
}

/** Refuses adds to one queue only: a blanket false would also break the run's own transfers. */
export function refuseQueue(queueName: string) {
  const realEnqueue = t.bullMq.enqueue.bind(t.bullMq);
  return vi
    .spyOn(t.bullMq, 'enqueue')
    .mockImplementation((queue, jobName, data, opts) =>
      queue === queueName ? Promise.resolve(false) : realEnqueue(queue, jobName, data, opts),
    );
}

/**
 * Drives the real ledger path (claim -> consume -> finalize) to a terminal run. The
 * production executor is the queue pair; this is only its synchronous stand-in.
 */
export async function driveRun<T extends BackupResult | RestoreResult>(
  runId: string,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  let last: BackupRunStatus | undefined;
  for (let pass = 0; pass < 200 && Date.now() < deadline; pass++) {
    const status = await t.svc.getRunStatus(runId);
    last = status;
    if (status.state === 'completed') return status.result as T;
    if (status.state !== 'running' && status.state !== 'finalizing') {
      throw new Error(status.error ?? `${label} ${status.state}`);
    }
    if ((await t.svc.runTransfersOnce(true)) === 0) {
      const after = await t.svc.getRunStatus(runId);
      if (after.state === 'completed') return after.result as T;
      throw new Error(after.error ?? `${label} stalled in ${after.state}`);
    }
  }
  throw new Error(
    `${label} did not finish (last state ${last?.state ?? 'unknown'}, file ${last?.currentFile ?? '-'})`,
  );
}

export async function runBackup(emailOrId: string): Promise<BackupResult> {
  const { runId } = await t.svc.startBackup(emailOrId);
  return driveRun<BackupResult>(runId, 'Backup');
}

export async function runRestore(emailOrId: string, restoreEmail?: string): Promise<RestoreResult> {
  const { runId } = await t.svc.startRestore(emailOrId, restoreEmail);
  return driveRun<RestoreResult>(runId, 'Restore');
}

/** Creates a user and N originals — the fixture every incremental-gate case starts from. */
export async function seedUserWithFiles(
  count: number,
  prefixLabel: string,
): Promise<{ user: User; seeded: { record: FileRecord; bytes: Buffer }[] }> {
  const email = `${prefixLabel}-${randomUUID()}@example.com`;
  const user = await t.userRepo.save(
    t.userRepo.create({
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

/** A user with one backed-up original, addressed by email (overview cases). */
export async function backupOneFile(
  email: string,
): Promise<{ user: User; prefix: string; manifestKey: string }> {
  const u = await t.userRepo.save(
    t.userRepo.create({
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

/** A user with one backed-up original, addressed by id (collision cases). */
export async function backupSingle(email: string): Promise<{ user: User; prefix: string }> {
  const u = await t.userRepo.save(
    t.userRepo.create({
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

/** A live user with one asset + one backed-up original (deleteBackup cases). */
export async function backupSingleFile(
  email: string,
): Promise<{ user: User; prefix: string; fileId: string; assetId: string }> {
  const u = await t.userRepo.save(
    t.userRepo.create({
      email,
      role: 'user',
      passwordHash: 'test-hash',
      displayName: 'Delete User',
    }),
  );
  const seeded = await seedOriginal(u.id, Buffer.from(`delete-bytes-${email}`));
  const asset = await t.assetRepo.save(
    t.assetRepo.create({
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

/** A user with a full media graph (file, asset, album, share, person) for merge cases. */
export async function seedAccount(email: string): Promise<{
  user: User;
  file: FileRecord;
  bytes: Buffer;
  asset: Asset;
  album: Album;
  share: Share;
  person: Person;
}> {
  const user = await t.userRepo.save(
    t.userRepo.create({
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
  const asset = await t.assetRepo.save(
    t.assetRepo.create({
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
  const album = await t.albumRepo.save(
    t.albumRepo.create({
      userId: user.id,
      name: 'Legacy Trip',
      description: 'old album',
      hiddenFromTimeline: true,
    }),
  );
  await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: asset.id }));
  const share = await t.shareRepo.save(
    t.shareRepo.create({
      userId: user.id,
      kind: 'asset',
      assetId: asset.id,
      albumId: null,
      token: createHash('sha256').update(randomUUID()).digest('hex'),
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    }),
  );
  const person = await t.personRepo.save(
    t.personRepo.create({
      userId: user.id,
      name: 'Mom',
      coverFaceId: null,
      clusterLabel: 'c1',
      faceCount: 5,
    }),
  );
  return { user, file: seeded.record, bytes: seeded.bytes, asset, album, share, person };
}
