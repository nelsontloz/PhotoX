import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NotFoundException } from '@nestjs/common';
import { Worker } from 'bullmq';
import { backupPrefix, loadEnv, manifestKey, originalKey } from '@photox/shared-config';
import { BackupRun } from '../../src/database/entities/backup-run.entity';
import type { UserBackupManifest } from '../../src/backup/user-backup.service';
import {
  closeBackupTestApp,
  createBackupTestApp,
  t,
  expectManifestLast,
  queueJobsFor,
  refuseQueue,
  resetBackupDb,
  runBackup,
  runRestore,
  seedFile,
  seedOriginal,
  wipeUserData,
} from './helpers/user-backup';

describe('user backup round-trip', () => {
  // 120s: boots its own Postgres pool from the run's template database
  beforeAll(createBackupTestApp, 120_000);
  afterAll(closeBackupTestApp);
  beforeEach(resetBackupDb);

  it('backs up and restores one user via EMAIL with same UUIDs (M1/M2/M4)', async () => {
    const email = `backup-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
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
    const photoAsset = await t.assetRepo.save(
      t.assetRepo.create({
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
    const videoAsset = await t.assetRepo.save(
      t.assetRepo.create({
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
    const trashedAsset = await t.assetRepo.save(
      t.assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: trash.record.id,
        isTrashed: true,
        trashedAt: new Date(),
        mimeType: 'image/png',
      }),
    );

    const album = await t.albumRepo.save(
      t.albumRepo.create({
        userId: user.id,
        name: 'Trip',
        description: null,
        hiddenFromTimeline: true,
      }),
    );
    await t.albumAssetRepo.save(
      t.albumAssetRepo.create({ albumId: album.id, assetId: photoAsset.id }),
    );
    const token = createHash('sha256').update(randomUUID()).digest('hex');
    const share = await t.shareRepo.save(
      t.shareRepo.create({
        userId: user.id,
        kind: 'asset',
        assetId: photoAsset.id,
        albumId: null,
        token,
        expiresAt: null,
      }),
    );
    const person = await t.personRepo.save(
      t.personRepo.create({
        userId: user.id,
        name: 'Mom',
        // the manifest drops the cover (it points at regenerated faces), and a dangling id is
        // no longer representable now that persons.coverFaceId is a FK
        coverFaceId: null,
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
    const manifestObjectKey = t.fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const manifest = JSON.parse((await t.fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      albums: { id: string; hiddenFromTimeline?: boolean }[];
    };
    expect(manifest.albums).toHaveLength(1);
    expect(manifest.albums[0]).toMatchObject({ id: album.id, hiddenFromTimeline: true });

    const status = await t.svc.backupStatus(email.toUpperCase());
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

    const restoredUser = await t.userRepo.findOneOrFail({ where: { id: user.id } });
    expect(restoredUser.email).toBe(email);

    for (const f of [photo, video, trash]) {
      const row = await t.fileRepo.findOneOrFail({ where: { id: f.record.id } });
      expect(row.storageKey).toBe(f.record.storageKey);
      expect(await readFile(t.storage.pathFor(row.storageKey))).toEqual(f.bytes);
    }

    for (const id of [photoAsset.id, videoAsset.id]) {
      const row = await t.assetRepo.findOneOrFail({ where: { id } });
      expect(row.metadataStatus).toBe('pending');
      expect(row.metadataExtractedAt).toBeNull();
      expect(row.phash).toBeNull();
      expect(row.transcodeFileId).toBeNull();
    }
    const trashedAfter = await t.assetRepo.findOneOrFail({ where: { id: trashedAsset.id } });
    expect(trashedAfter.isTrashed).toBe(true);
    expect(trashedAfter.trashedAt).not.toBeNull();

    const albumAfter = await t.albumRepo.findOneOrFail({ where: { id: album.id } });
    expect(albumAfter.hiddenFromTimeline).toBe(true);
    await t.albumAssetRepo.findOneOrFail({
      where: { albumId: album.id, assetId: photoAsset.id },
    });
    const shareAfter = await t.shareRepo.findOneOrFail({ where: { id: share.id } });
    expect(shareAfter.token).toBe(token);
    const personAfter = await t.personRepo.findOneOrFail({ where: { id: person.id } });
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
    const user = await t.userRepo.save(
      t.userRepo.create({
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
    const asset = await t.assetRepo.save(
      t.assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: photo.record.id,
        isTrashed: false,
        mimeType: 'image/png',
      }),
    );
    const album = await t.albumRepo.save(
      t.albumRepo.create({ userId: user.id, name: 'Old Trip', description: null }),
    );
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: asset.id }));

    await runBackup(user.id);

    // rewrite the published manifest as an old core would have written it
    const manifestObjectKey = t.fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const stored = JSON.parse((await t.fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      albums: Record<string, unknown>[];
    };
    delete stored.albums[0]!.hiddenFromTimeline;
    await t.fake.putObject(manifestObjectKey, Buffer.from(JSON.stringify(stored)));

    await wipeUserData();
    await runRestore(user.id);

    const albumAfter = await t.albumRepo.findOneOrFail({ where: { id: album.id } });
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
    await t.fake.putObject(manifestKey(email, userId), Buffer.from(JSON.stringify(manifest)));

    const { runId } = await t.svc.startRestore(userId);

    expect(await t.fileRepo.count({ where: { userId } })).toBe(1600);
    expect(await t.assetRepo.count({ where: { userId } })).toBe(1600);
    await expect(t.svc.getRunStatus(runId)).resolves.toMatchObject({
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
    const user = await t.userRepo.save(
      t.userRepo.create({
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
    const photoAsset = await t.assetRepo.save(
      t.assetRepo.create({
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
    const videoAsset = await t.assetRepo.save(
      t.assetRepo.create({
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
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Rerun User',
      }),
    );
    const a = await seedOriginal(user.id, Buffer.from('rerun-a-bytes'));
    const b = await seedOriginal(user.id, Buffer.from('rerun-b-bytes'));
    await t.assetRepo.save(
      t.assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: a.record.id,
        isTrashed: false,
      }),
    );
    await t.assetRepo.save(
      t.assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: b.record.id,
        isTrashed: false,
      }),
    );

    // per-file retries: exhaust the attempt budget so the run still fails and writes no manifest
    t.fake.failNextPuts = 10;
    await expect(runBackup(user.id)).rejects.toThrow('injected putFile failure');
    // manifest-last: the failed run leaves no live manifest over missing bytes
    expect([...t.fake.objects.keys()].some((k) => k.endsWith('manifest.json'))).toBe(false);

    t.fake.ops = [];
    t.fake.failNextPuts = 0;
    const backed = await runBackup(user.id);
    expect(backed.files).toBe(2);
    expectManifestLast();

    await wipeUserData();
    const restored = await runRestore(email);
    expect(restored.files).toBe(2);
    for (const f of [a, b]) {
      const row = await t.fileRepo.findOneOrFail({ where: { id: f.record.id } });
      expect(await readFile(t.storage.pathFor(row.storageKey))).toEqual(f.bytes);
    }
  });

  it('drives a backup through the async ledger and reports run status', async () => {
    const email = `async-run-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Async Run',
      }),
    );
    const a = await seedOriginal(user.id, Buffer.from('async-run-a'));
    const b = await seedOriginal(user.id, Buffer.from('async-run-b'));
    await t.assetRepo.save([
      t.assetRepo.create({ userId: user.id, kind: 'photo', fileId: a.record.id, isTrashed: false }),
      t.assetRepo.create({ userId: user.id, kind: 'photo', fileId: b.record.id, isTrashed: false }),
    ]);

    const { runId } = await t.svc.startBackup(user.id);
    expect((await t.svc.getRunStatus(runId)).state).toBe('running');
    for (let i = 0; i < 20; i++) {
      if ((await t.svc.getRunStatus(runId)).state !== 'running') break;
      await t.svc.runTransfersOnce();
    }

    const status = await t.svc.getRunStatus(runId);
    expect(status.state).toBe('completed');
    expect(status.result).toMatchObject({ files: 2, uploaded: 2, skipped: 0 });
    expectManifestLast();
  });

  it('retries a transient file failure alone without failing the run', async () => {
    const email = `async-retry-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Async Retry',
      }),
    );
    const a = await seedOriginal(user.id, Buffer.from('async-retry-a'));
    const b = await seedOriginal(user.id, Buffer.from('async-retry-b'));
    await t.assetRepo.save([
      t.assetRepo.create({ userId: user.id, kind: 'photo', fileId: a.record.id, isTrashed: false }),
      t.assetRepo.create({ userId: user.id, kind: 'photo', fileId: b.record.id, isTrashed: false }),
    ]);

    t.fake.failNextPuts = 2;
    const { runId } = await t.svc.startBackup(user.id);
    for (let i = 0; i < 20; i++) {
      if ((await t.svc.getRunStatus(runId)).state !== 'running') break;
      // the ledger backs off between attempts; the API exposes the no-backoff driver for tests
      await t.svc.runTransfersOnce(true);
    }

    const status = await t.svc.getRunStatus(runId);
    expect(status.state).toBe('completed');
    expect(status.result).toMatchObject({ files: 2, uploaded: 2 });
    expect(t.fake.putAttempts).toBe(4);
    expectManifestLast();
  });

  it('resumes a failed restore of the same manifest instead of 409ing', async () => {
    const email = `async-resume-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Async Resume',
      }),
    );
    const photo = await seedOriginal(user.id, Buffer.from('async-resume-bytes'));
    const asset = await t.assetRepo.save(
      t.assetRepo.create({
        userId: user.id,
        kind: 'photo',
        fileId: photo.record.id,
        isTrashed: false,
      }),
    );
    await runBackup(user.id);
    const key = originalKey(email, user.id, photo.record.id, 'bin');

    await wipeUserData();
    t.fake.objects.delete(key);

    const first = await t.svc.startRestore(user.id);
    for (let i = 0; i < 20; i++) {
      if ((await t.svc.getRunStatus(first.runId)).state !== 'running') break;
      await t.svc.runTransfersOnce();
    }
    const failed = await t.svc.getRunStatus(first.runId);
    expect(failed.state).toBe('failed');
    expect(failed.error).toContain('could not be restored');
    // no silent 404: the asset row came back but its bytes did not, so it is trashed
    expect((await t.assetRepo.findOneOrFail({ where: { id: asset.id } })).isTrashed).toBe(true);

    t.fake.objects.set(key, photo.bytes);
    const second = await t.svc.startRestore(user.id);
    expect(second.runId).toBe(first.runId);
    for (let i = 0; i < 20; i++) {
      if ((await t.svc.getRunStatus(second.runId)).state !== 'running') break;
      await t.svc.runTransfersOnce();
    }

    const done = await t.svc.getRunStatus(second.runId);
    expect(done.state).toBe('completed');
    expect(done.result).toMatchObject({ files: 1, assets: 1 });
    expect((await t.assetRepo.findOneOrFail({ where: { id: asset.id } })).isTrashed).toBe(false);
    const row = await t.fileRepo.findOneOrFail({ where: { id: photo.record.id } });
    expect(await readFile(t.storage.pathFor(row.storageKey))).toEqual(photo.bytes);
  });

  // Regression: `enqueue` swallows a Redis failure and returns false, so the old code counted
  // jobs that were never added and completed the run — assets restored, derivatives queued
  // nowhere, and no sweep for `pending`. A refused add must fail the run and stay retryable.
  it('fails a restore whose derivative enqueue is refused instead of reporting completed', async () => {
    const email = `enqueue-refused-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Enqueue Refused',
      }),
    );
    const photo = await seedOriginal(user.id, Buffer.from('enqueue-refused-bytes'));
    await t.assetRepo.save(
      t.assetRepo.create({
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
    const spy = refuseQueue('process-metadata');
    let runId: string;
    try {
      ({ runId } = await t.svc.startRestore(user.id));
      for (let i = 0; i < 20; i++) {
        const state = (await t.svc.getRunStatus(runId)).state;
        if (state !== 'running' && state !== 'finalizing') break;
        await t.svc.runTransfersOnce();
      }
      const failed = await t.svc.getRunStatus(runId);
      expect(failed.state).toBe('failed');
      expect(failed.error).toContain('enqueue');
      expect(await queueJobsFor('process-metadata', user.id)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }

    // failed, not wedged: the same manifest resumes and the retry really enqueues
    const retry = await t.svc.startRestore(user.id);
    expect(retry.runId).toBe(runId);
    for (let i = 0; i < 20; i++) {
      const state = (await t.svc.getRunStatus(retry.runId)).state;
      if (state !== 'running' && state !== 'finalizing') break;
      await t.svc.runTransfersOnce();
    }
    const done = await t.svc.getRunStatus(retry.runId);
    expect(done.state).toBe('completed');
    expect(await queueJobsFor('process-metadata', user.id)).toHaveLength(1);
  });

  it('backs up original bytes only, skipping thumbnail/transcode derivatives', async () => {
    const email = `derivatives-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Derivatives User',
      }),
    );
    const original = await seedOriginal(user.id, Buffer.from('derivative-test-original'));
    const thumbBytes = Buffer.from('derivative-test-thumb');
    await seedFile(user.id, `derivatives/${user.id}/thumbnails/${randomUUID()}.webp`, thumbBytes, {
      mimeType: 'image/webp',
      originalName: 'thumb-sm.webp',
      purpose: 'original',
    });
    const transcodeBytes = Buffer.from('derivative-test-transcode');
    await seedFile(
      user.id,
      `derivatives/${user.id}/transcodes/${randomUUID()}.mp4`,
      transcodeBytes,
      { mimeType: 'video/mp4', originalName: 'clip-transcode.mp4', purpose: 'transcode' },
    );
    // pre-flattening key, still a derivative by prefix
    const legacyBytes = Buffer.from('derivative-test-legacy-transcode');
    await seedFile(user.id, `derivatives/transcodes/${user.id}/${randomUUID()}.mp4`, legacyBytes, {
      mimeType: 'video/mp4',
      originalName: 'legacy-transcode.mp4',
      purpose: 'original',
    });

    // pre-fix rerun leaves stale thumbnail bytes under originals/ — prune must delete them
    const staleKey = `${backupPrefix(email, user.id)}originals/${randomUUID()}.webp`;
    t.fake.objects.set(staleKey, Buffer.from('stale-thumb-bytes'));

    const backed = await runBackup(user.id);
    expect(backed.files).toBe(1);
    const putFiles = t.fake.ops.filter((o) => o.op === 'putFile');
    expect(putFiles).toHaveLength(1);
    const manifestObjectKey = t.fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const manifest = JSON.parse((await t.fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
      files: { id: string; storageKey: string }[];
    };
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]!.id).toBe(original.record.id);
    expect(manifest.files[0]!.storageKey.startsWith('originals/')).toBe(true);
    expectManifestLast();
    // stale pre-fix bytes are pruned only after the new manifest is published, expected
    // original remains
    expect(t.fake.objects.has(staleKey)).toBe(false);
    expect(t.fake.objects.has(putFiles[0]!.key)).toBe(true);
    const deletes = t.fake.ops.filter((o) => o.op === 'deleteKey');
    expect(deletes.map((o) => o.key)).toContain(staleKey);
    const manifestIdx = t.fake.ops.findIndex((o) => o.key.endsWith('manifest.json'));
    for (const op of deletes) {
      expect(t.fake.ops.indexOf(op)).toBeGreaterThan(manifestIdx);
    }

    const status = await t.svc.backupStatus(user.id);
    expect(status).toMatchObject({ exists: true, userId: user.id, files: 1 });
  });

  it('reports original-only status and skips derivatives on restore for legacy manifests', async () => {
    const email = `legacy-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
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
    const manifestObjectKey = t.fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
    const stored = JSON.parse((await t.fake.getBuffer(manifestObjectKey)).toString('utf-8')) as {
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
    await t.fake.putObject(manifestObjectKey, Buffer.from(JSON.stringify(stored)));
    const prefix = manifestObjectKey.slice(0, -'manifest.json'.length);
    await t.fake.putFile(
      `${prefix}originals/${thumb.id}.webp`,
      t.storage.pathFor(thumb.storageKey),
    );

    // status reports original-only despite the legacy derivative entry
    expect((await t.svc.backupStatus(user.id)).files).toBe(1);

    await wipeUserData();

    const restored = await runRestore(email);
    expect(restored.files).toBe(1);
    const restoredOriginal = await t.fileRepo.findOneOrFail({ where: { id: original.record.id } });
    expect(await readFile(t.storage.pathFor(restoredOriginal.storageKey))).toEqual(original.bytes);
    expect(await t.fileRepo.findOne({ where: { id: thumb.id } })).toBeNull();
    expect(await t.storage.exists(thumb.storageKey)).toBe(false);
    expect((await t.svc.backupStatus(email)).files).toBe(1);
  });

  it('backupStatus is false for unknown users and missing manifests (A4)', async () => {
    await expect(t.svc.backupStatus(`ghost-${randomUUID()}@example.com`)).resolves.toEqual({
      exists: false,
    });

    const email = `status-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Status User',
      }),
    );
    await seedOriginal(user.id, Buffer.from('status-bytes'));
    await runBackup(user.id);
    expect((await t.svc.backupStatus(email)).exists).toBe(true);

    for (const key of [...t.fake.objects.keys()]) {
      if (key.endsWith('manifest.json')) t.fake.objects.delete(key);
    }
    // isNotFound covers NoSuchKey/NotFound/NoSuchBucket, not one name
    await expect(t.svc.backupStatus(email)).resolves.toEqual({ exists: false });
  });

  it('reports a non-terminal run on the overview row so a reload can resume progress', async () => {
    const email = `active-run-${randomUUID()}@example.com`;
    const user = await t.userRepo.save(
      t.userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'Active Run',
      }),
    );
    await seedOriginal(user.id, Buffer.from('active-run-bytes'));

    const { runId } = await t.svc.startBackup(user.id);
    const row = (await t.svc.backupOverview()).find((entry) => entry.userId === user.id);
    expect(row?.activeRun).toEqual({ id: runId, kind: 'backup', state: 'running' });

    // the overview's activeRun is a projection of a non-terminal run row, not of cancel
    await t.dataSource.getRepository(BackupRun).update(runId, {
      state: 'cancelled',
      currentFile: null,
      finishedAt: new Date(),
    });
    const after = (await t.svc.backupOverview()).find((entry) => entry.userId === user.id);
    expect(after?.activeRun).toBeUndefined();
  }, 120_000);
});
