import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { vi } from 'vitest';
import { In } from 'typeorm';
import { backupPrefix, manifestKey, originalKey } from '@photox/shared-config';
import type { UserBackupManifest } from '../../src/backup/user-backup.service';
import {
  backupSingleFile,
  closeBackupTestApp,
  createBackupTestApp,
  t,
  deleteAccountRow,
  queueJobsFor,
  refuseQueue,
  resetBackupDb,
  runBackup,
  seedAccount,
  seedOriginal,
} from './helpers/user-backup';

describe('user backup round-trip', () => {
  // 120s: boots its own Postgres pool from the run's template database
  beforeAll(createBackupTestApp, 120_000);
  afterAll(closeBackupTestApp);
  beforeEach(resetBackupDb);

  describe('deleteBackup', () => {
    it('deletes a live user backup without touching DB rows, then re-backup works', async () => {
      const email = `delete-live-${randomUUID()}@example.com`;
      const { user, prefix, fileId, assetId } = await backupSingleFile(email);

      const deleted = await t.svc.deleteBackup(email);
      expect(deleted).toEqual({ userId: user.id, email, prefix, deletedObjects: 2 });

      // overview + status read exists:false while the rows stay live
      await expect(t.svc.backupStatus(email)).resolves.toEqual({ exists: false });
      const rows = await t.svc.backupOverview();
      expect(rows.find((r) => r.userId === user.id)).toMatchObject({
        email,
        deleted: false,
        exists: false,
      });
      await t.userRepo.findOneOrFail({ where: { id: user.id } });
      await t.fileRepo.findOneOrFail({ where: { id: fileId } });
      await t.assetRepo.findOneOrFail({ where: { id: assetId } });

      // next backup recreates the prefix from scratch
      const re = await runBackup(user.id);
      expect(re).toMatchObject({ userId: user.id, prefix, files: 1 });
      await expect(t.svc.backupStatus(email)).resolves.toMatchObject({ exists: true, files: 1 });
    });

    it('deletes an orphan backup by userId and drops it from the overview', async () => {
      const email = `delete-orphan-${randomUUID()}@example.com`;
      const { user, prefix } = await backupSingleFile(email);
      await t.shareRepo.delete({ userId: user.id });
      await t.personRepo.delete({ userId: user.id });
      await t.assetRepo.delete({ userId: user.id });
      await t.fileRepo.delete({ userId: user.id });
      await t.albumRepo.delete({ userId: user.id });
      await deleteAccountRow(user.id);

      const deleted = await t.svc.deleteBackup(user.id);
      expect(deleted).toEqual({ userId: user.id, email, prefix, deletedObjects: 2 });
      await expect(t.fake.listKeys(prefix)).resolves.toEqual([]);
      expect([...t.fake.objects.keys()].some((k) => k.startsWith(prefix))).toBe(false);

      const rows = await t.svc.backupOverview();
      expect(rows.some((r) => r.userId === user.id)).toBe(false);
      await expect(t.svc.backupStatus(email)).resolves.toEqual({ exists: false });
    });

    it('throws 404 for unknown ids and emails', async () => {
      await expect(t.svc.deleteBackup(randomUUID())).rejects.toThrow(NotFoundException);
      await expect(t.svc.deleteBackup(`ghost-${randomUUID()}@example.com`)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('merge backups', () => {
    /** Rows only — the account itself stays live (a stale snapshot over a live user). */
    async function deleteOwnedRows(userId: string): Promise<void> {
      const albums = await t.albumRepo.find({ where: { userId } });
      if (albums.length > 0) {
        await t.albumAssetRepo.delete({ albumId: In(albums.map((album) => album.id)) });
      }
      await t.shareRepo.delete({ userId });
      await t.personRepo.delete({ userId });
      await t.assetRepo.delete({ userId });
      await t.fileRepo.delete({ userId });
      await t.albumRepo.delete({ userId });
    }

    async function deleteAccountRows(userId: string): Promise<void> {
      await deleteOwnedRows(userId);
      await deleteAccountRow(userId);
    }

    it('merges a matched legacy snapshot, adopts it into the live prefix and removes the source', async () => {
      const email = `merge-${randomUUID()}@example.com`;
      const legacy = await seedAccount(email);
      const legacyBackup = await runBackup(legacy.user.id);
      const legacyPrefix = legacyBackup.prefix;
      const legacyId = legacy.user.id;
      await deleteAccountRows(legacyId);

      const target = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target Profile',
        }),
      );
      const result = await t.svc.mergeUserBackup({
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
      const after = await t.userRepo.findOneOrFail({ where: { id: target.id } });
      expect(after).toMatchObject({
        email,
        role: 'user',
        passwordHash: 'target-hash',
        displayName: 'Target Profile',
        tokensValidAfter: null,
      });

      // old UUIDs re-created under the target; bytes live under the target namespace
      const fileAfter = await t.fileRepo.findOneOrFail({ where: { id: legacy.file.id } });
      expect(fileAfter.userId).toBe(target.id);
      expect(fileAfter.storageKey.startsWith(`originals/${target.id}/`)).toBe(true);
      expect(await readFile(t.storage.pathFor(fileAfter.storageKey))).toEqual(legacy.bytes);
      const assetAfter = await t.assetRepo.findOneOrFail({ where: { id: legacy.asset.id } });
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
      const albumAfter = await t.albumRepo.findOneOrFail({ where: { id: legacy.album.id } });
      expect(albumAfter.userId).toBe(target.id);
      expect(albumAfter.hiddenFromTimeline).toBe(true);
      await t.albumAssetRepo.findOneOrFail({
        where: { albumId: legacy.album.id, assetId: legacy.asset.id },
      });
      const shareAfter = await t.shareRepo.findOneOrFail({ where: { id: legacy.share.id } });
      expect(shareAfter).toMatchObject({ userId: target.id, assetId: legacy.asset.id });
      expect(shareAfter.expiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));
      const personAfter = await t.personRepo.findOneOrFail({ where: { id: legacy.person.id } });
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
      await expect(t.fake.listKeys(legacyPrefix)).resolves.toEqual([]);
      const targetKeys = await t.fake.listKeys(targetPrefix);
      expect(targetKeys).toHaveLength(2);
      expect(targetKeys).toEqual(
        expect.arrayContaining([
          manifestKey(email, target.id),
          originalKey(email, target.id, legacy.file.id, 'bin'),
        ]),
      );

      const targetManifest = JSON.parse(
        (await t.fake.getBuffer(manifestKey(email, target.id))).toString('utf-8'),
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
        expect(t.fake.objects.has(originalKey(email, target.id, entry.id, ext))).toBe(true);
      }

      // durable ledger
      const ledger = await t.mergeRepo.findOneOrFail({
        where: { backupUserId: legacyId, targetUserId: target.id },
      });
      expect(ledger.prefix).toBe(legacyPrefix);
      expect(ledger.counts).toMatchObject({ files: 1, assets: 1 });

      // the live row is now the normal backup: its own manifest at the target
      // prefix, no previous-account sub-row and no mergedAt/backupUserId extras
      const row = (await t.svc.backupOverview()).find((r) => r.userId === target.id)!;
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
      await expect(t.svc.backupStatus(email)).resolves.toMatchObject({ exists: true, files: 1 });

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
      const target = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target',
        }),
      );

      const spy = refuseQueue('process-metadata');
      try {
        await expect(
          t.svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacyId }),
        ).rejects.toThrow(ServiceUnavailableException);
      } finally {
        spy.mockRestore();
      }

      // the ledger lands after the derivatives, so nothing claims the merge and the
      // documented plain retry is still allowed
      expect(
        await t.mergeRepo.findOne({ where: { backupUserId: legacyId, targetUserId: target.id } }),
      ).toBeNull();
      expect(await queueJobsFor('process-metadata', target.id)).toHaveLength(0);
    });

    it('recovers from a failed adoption with a retry that replays the merge', async () => {
      const email = `merge-retry-${randomUUID()}@example.com`;
      const legacy = await seedAccount(email);
      const legacyPrefix = (await runBackup(legacy.user.id)).prefix;
      const legacyId = legacy.user.id;
      await deleteAccountRows(legacyId);

      const target = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Retry Target',
        }),
      );

      // Rows/bytes land, then adoption's S3 copy fails: no ledger, source kept, so
      // a plain retry is still allowed.
      t.fake.failNextCopies = 1;
      const failed = await t.svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: legacyId,
      });
      expect(failed.assigned).toBeNull();
      expect(failed.adoptionError).toContain('injected copyKey failure');
      expect((await t.fake.listKeys(legacyPrefix)).length).toBeGreaterThan(0);
      expect(
        await t.mergeRepo.findOne({
          where: { backupUserId: legacyId, targetUserId: target.id },
        }),
      ).toBeNull();

      // The retry finds the already-merged rows (skipped), re-enqueues their
      // derivatives, adopts the source and removes it.
      const retry = await t.svc.mergeUserBackup({
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
      await expect(t.fake.listKeys(legacyPrefix)).resolves.toEqual([]);
    }, 120_000);

    it('dedupes identical originals and relinks album/share targets to the live asset', async () => {
      const email = `merge-dedupe-${randomUUID()}@example.com`;
      const bytes = Buffer.from('merge-dedupe-shared-bytes');
      const legacyUser = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'legacy-hash',
          displayName: 'Legacy Dedupe',
        }),
      );
      const legacyFile = await seedOriginal(legacyUser.id, bytes);
      const legacyAsset = await t.assetRepo.save(
        t.assetRepo.create({ userId: legacyUser.id, kind: 'photo', fileId: legacyFile.record.id }),
      );
      const legacyAlbum = await t.albumRepo.save(
        t.albumRepo.create({ userId: legacyUser.id, name: 'Dedupe Album', description: null }),
      );
      await t.albumAssetRepo.save(
        t.albumAssetRepo.create({ albumId: legacyAlbum.id, assetId: legacyAsset.id }),
      );
      const legacyShare = await t.shareRepo.save(
        t.shareRepo.create({
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

      const target = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Target Dedupe',
        }),
      );
      const targetFile = await seedOriginal(target.id, bytes);
      const targetAsset = await t.assetRepo.save(
        t.assetRepo.create({ userId: target.id, kind: 'photo', fileId: targetFile.record.id }),
      );

      const result = await t.svc.mergeUserBackup({
        targetEmailOrId: email,
        backupUserId: legacyUser.id,
      });
      expect(result.deduped).toEqual({ files: 1, assets: 1 });
      expect(result.merged).toMatchObject({ files: 0, assets: 0, albums: 1, shares: 1 });
      expect(await t.assetRepo.findOne({ where: { id: legacyAsset.id } })).toBeNull();
      expect(await t.fileRepo.findOne({ where: { id: legacyFile.record.id } })).toBeNull();
      await t.albumAssetRepo.findOneOrFail({
        where: { albumId: legacyAlbum.id, assetId: targetAsset.id },
      });
      const shareAfter = await t.shareRepo.findOneOrFail({ where: { id: legacyShare.id } });
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
        (await t.fake.getBuffer(manifestKey(email, target.id))).toString('utf-8'),
      ) as UserBackupManifest;
      expect(targetManifest.files.map((file) => file.id)).toEqual([targetFile.record.id]);
      expect(targetManifest.assets.map((asset) => asset.id)).toEqual([targetAsset.id]);
      expect(targetManifest.files.some((file) => file.id === legacyFile.record.id)).toBe(false);
      expect(targetManifest.assets.some((asset) => asset.id === legacyAsset.id)).toBe(false);
      // the source copy is gone; the single remaining original lives under the
      // target prefix under the live file id
      expect([...t.fake.objects.keys()].filter((key) => key.includes('/originals/'))).toEqual([
        originalKey(email, target.id, targetFile.record.id, 'bin'),
      ]);
      expect(result.enqueued).toEqual({ metadata: 0, thumbnails: 0, videos: 0, faces: 0, ai: 0 });
    }, 120_000);

    it('rejects an email mismatch, a second merge and a missing source', async () => {
      const email = `merge-conflict-${randomUUID()}@example.com`;
      const legacy = await seedAccount(email);
      await runBackup(legacy.user.id);
      await deleteAccountRows(legacy.user.id);

      const target = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Conflict Target',
        }),
      );
      const other = await t.userRepo.save(
        t.userRepo.create({
          email: `other-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Other',
        }),
      );

      // Mismatch runs before the successful merge: adoption deletes the source, so
      // the email check must see the snapshot while it still exists.
      const mismatch = await t.svc
        .mergeUserBackup({ targetEmailOrId: other.id, backupUserId: legacy.user.id, force: true })
        .catch((err: unknown) => err);
      expect(mismatch).toBeInstanceOf(ConflictException);
      expect((mismatch as ConflictException).message).toContain('email-mismatch');

      await t.svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id });

      // The ledger check runs before source resolution: the source is gone now, but
      // a plain repeat must still answer 409 already-merged instead of 404.
      const second = await t.svc
        .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id })
        .catch((err: unknown) => err);
      expect(second).toBeInstanceOf(ConflictException);
      expect((second as ConflictException).message).toContain('already-merged');

      await expect(
        t.svc.mergeUserBackup({ targetEmailOrId: target.id, backupUserId: randomUUID() }),
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
        const target = await t.userRepo.save(
          t.userRepo.create({
            email,
            role: 'user',
            passwordHash: 'target-hash',
            displayName: 'Quota Target',
          }),
        );

        const rejected = await t.svc
          .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: legacy.user.id })
          .catch((err: unknown) => err);
        expect(rejected).toBeInstanceOf(PayloadTooLargeException);
        expect((rejected as Error).message).toMatch(/used \d+ \+ incoming \d+ > quota 8/);

        const forced = await t.svc.mergeUserBackup({
          targetEmailOrId: target.id,
          backupUserId: legacy.user.id,
          force: true,
        });
        expect(forced.merged.files).toBe(1);
        expect(forced.assigned).toMatchObject({
          prefix: backupPrefix(email, target.id),
          sourceDeleted: true,
        });
        await expect(t.fake.listKeys(legacyPrefix)).resolves.toEqual([]);
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
      await t.userRepo.update(source.user.id, {
        email: `merge-live-moved-${randomUUID()}@example.com`,
      });
      // Another account registers the freed address: the manifest label now matches it.
      const target = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Live Source Target',
        }),
      );

      const keysBefore = [...t.fake.objects.keys()].sort();
      const err = await t.svc
        .mergeUserBackup({ targetEmailOrId: target.id, backupUserId: source.user.id })
        .catch((e: unknown) => e);

      expect(snapshot.prefix).toBe(backupPrefix(email, source.user.id));
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toContain('source-alive');
      // Nothing adopted into the target and no backup bytes deleted: the live account
      // keeps the snapshot the merge was about to take from it.
      expect([...t.fake.objects.keys()].sort()).toEqual(keysBefore);
      expect(await t.assetRepo.count({ where: { userId: target.id } })).toBe(0);
      expect(await t.assetRepo.count({ where: { userId: source.user.id } })).toBe(0);
    }, 120_000);

    it('deletes only the merged prefix, not another backup of the same account id', async () => {
      const email = `merge-scope-${randomUUID()}@example.com`;
      const source = await seedAccount(email);
      const mergedPrefix = (await runBackup(source.user.id)).prefix;

      // The account changes its address and backs up again. The old prefix's clean-up
      // fails here, so one account id ends up with two prefixes — the state a failed
      // rename/delete leaves behind in production.
      await t.userRepo.update(source.user.id, {
        email: `merge-scope-moved-${randomUUID()}@example.com`,
      });
      const realDelete = t.fake.deleteKeys.bind(t.fake);
      const deleteSpy = vi
        .spyOn(t.fake, 'deleteKeys')
        .mockImplementation(async (keys: string[]): Promise<void> => {
          if (keys.some((key) => key.startsWith(mergedPrefix))) {
            throw new Error('injected delete failure');
          }
          return realDelete(keys);
        });
      // the spy must go even if the run throws, or it outlives the test
      const keptPrefix = await (async (): Promise<string> => {
        try {
          return (await runBackup(source.user.id)).prefix;
        } finally {
          deleteSpy.mockRestore();
        }
      })();

      expect(keptPrefix).not.toBe(mergedPrefix);
      expect(await t.fake.listKeys(mergedPrefix)).not.toEqual([]);
      expect(await t.fake.listKeys(keptPrefix)).not.toEqual([]);
      const keptKeysBefore = (await t.fake.listKeys(keptPrefix)).sort();

      // Rows gone, so the snapshot's ids no longer collide with a live owner.
      await deleteAccountRows(source.user.id);
      const target = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'target-hash',
          displayName: 'Scope Target',
        }),
      );

      // Merge the snapshot by its explicit prefix: the newest prefix is the other one,
      // and deleting the source by account id takes both.
      await t.svc.mergeUserBackup({
        targetEmailOrId: target.id,
        backupUserId: source.user.id,
        prefix: mergedPrefix,
      });

      await expect(t.fake.listKeys(mergedPrefix)).resolves.toEqual([]);
      expect((await t.fake.listKeys(keptPrefix)).sort()).toEqual(keptKeysBefore);
    }, 120_000);
  });
});
