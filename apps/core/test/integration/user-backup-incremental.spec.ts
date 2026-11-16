import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { backupPrefix } from '@photox/shared-config';
import {
  backupOneFile,
  closeBackupTestApp,
  createBackupTestApp,
  t,
  deleteAccountRow,
  resetBackupDb,
  runBackup,
  seedOriginal,
  seedUserWithFiles,
} from './helpers/user-backup';

describe('user backup round-trip', () => {
  // 120s: boots its own Postgres pool from the run's template database
  beforeAll(createBackupTestApp, 120_000);
  afterAll(closeBackupTestApp);
  beforeEach(resetBackupDb);

  describe('incremental gate + lazy rename', () => {
    it('skips all uploads on an unchanged rerun (uploaded 0, empty prune)', async () => {
      const { user } = await seedUserWithFiles(2, 'skipall');
      const first = await runBackup(user.id);
      expect(first.uploaded).toBe(2);
      expect(first.skipped).toBe(0);

      t.fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 0, skipped: 2 });
      expect(t.fake.ops.filter((o) => o.op === 'putFile')).toHaveLength(0);
      expect(t.fake.ops.filter((o) => o.op === 'putObject')).toHaveLength(1);
      // empty prune: no deletes when nothing is stale
      expect(t.fake.ops.filter((o) => o.op === 'deleteKey')).toHaveLength(0);
    });

    it('uploads only new files on the next run (delta-only)', async () => {
      const { user } = await seedUserWithFiles(2, 'delta');
      await runBackup(user.id);

      await seedOriginal(user.id, Buffer.from('delta-new-bytes'));
      t.fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 3, uploaded: 1, skipped: 2 });
      expect(t.fake.ops.filter((o) => o.op === 'putFile')).toHaveLength(1);
    });

    it('re-uploads when the checksum changes', async () => {
      const { user, seeded } = await seedUserWithFiles(2, 'checksum');
      await runBackup(user.id);

      const target = seeded[0]!.record;
      const nextBytes = Buffer.from('checksum-changed-bytes');
      await writeFile(t.storage.pathFor(target.storageKey), nextBytes);
      await t.fileRepo.update(target.id, {
        sizeBytes: nextBytes.length,
        checksumSha256: createHash('sha256').update(nextBytes).digest('hex'),
      });
      t.fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 1, skipped: 1 });
      const putKeys = t.fake.ops.filter((o) => o.op === 'putFile').map((o) => o.key);
      expect(putKeys).toHaveLength(1);
      expect(putKeys[0]).toContain(target.id);
    });

    it('falls back to a full upload on a missing manifest', async () => {
      const { user } = await seedUserWithFiles(2, 'missing-manifest');
      await runBackup(user.id);

      for (const key of [...t.fake.objects.keys()]) {
        if (key.endsWith('manifest.json')) t.fake.objects.delete(key);
      }
      t.fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 2, skipped: 0 });
    });

    it('falls back to a full upload on a corrupt manifest', async () => {
      const { user } = await seedUserWithFiles(2, 'corrupt-manifest');
      await runBackup(user.id);

      const manifestKey = t.fake.ops.find((o) => o.key.endsWith('manifest.json'))!.key;
      t.fake.objects.set(manifestKey, Buffer.from('not-json{{{'));
      t.fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 2, skipped: 0 });
    });

    it('re-uploads S3-missing keys despite a manifest match', async () => {
      const { user } = await seedUserWithFiles(2, 's3missing');
      await runBackup(user.id);

      const originalKeys = [...t.fake.objects.keys()].filter((k) => k.includes('/originals/'));
      expect(originalKeys).toHaveLength(2);
      t.fake.objects.delete(originalKeys[0]!);
      t.fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 2, uploaded: 1, skipped: 1 });
      expect(t.fake.ops.filter((o) => o.op === 'putFile').map((o) => o.key)).toEqual([
        originalKeys[0],
      ]);
    });

    it('uploads all and skips prune when listKeys fails', async () => {
      const { user } = await seedUserWithFiles(1, 'listfail');
      await runBackup(user.id);
      // second run would skip, but listing fails so every byte re-uploads
      t.fake.failListKeys = true;
      // stale key that prune would delete if listing worked
      const staleKey = `${backupPrefix((await t.userRepo.findOneOrFail({ where: { id: user.id } })).email, user.id)}originals/stale.webp`;
      t.fake.objects.set(staleKey, Buffer.from('stale'));
      t.fake.ops = [];
      const second = await runBackup(user.id);
      expect(second).toMatchObject({ files: 1, uploaded: 1, skipped: 0 });
      expect(t.fake.ops.filter((o) => o.op === 'deleteKey')).toHaveLength(0);
      expect(t.fake.objects.has(staleKey)).toBe(true);
      t.fake.failListKeys = false;
    });

    it('auto-renames on email change with ~0 uploads and copy→manifest→delete order', async () => {
      const { user, seeded } = await seedUserWithFiles(2, 'rename');
      const oldEmail = user.email;
      const oldPrefix = backupPrefix(oldEmail, user.id);
      await runBackup(user.id);
      expect([...t.fake.objects.keys()].some((k) => k.startsWith(oldPrefix))).toBe(true);

      const newEmail = `renamed-${randomUUID()}@example.com`;
      await t.userRepo.update(user.id, { email: newEmail });
      const newPrefix = backupPrefix(newEmail, user.id);
      t.fake.ops = [];

      const second = await runBackup(user.id);
      expect(second.prefix).toBe(newPrefix);
      expect(second.uploaded).toBeLessThanOrEqual(1);
      expect(second.skipped).toBeGreaterThanOrEqual(1);
      expect(second.files).toBe(2);

      // old prefix gone, new prefix holds the bytes + fresh manifest
      expect([...t.fake.objects.keys()].some((k) => k.startsWith(oldPrefix))).toBe(false);
      expect([...t.fake.objects.keys()].filter((k) => k.startsWith(newPrefix))).toHaveLength(3);
      for (const f of seeded) {
        const expectedSuffix = `/originals/${f.record.id}.`;
        expect(
          [...t.fake.objects.keys()].some(
            (k) => k.startsWith(newPrefix) && k.includes(expectedSuffix),
          ),
        ).toBe(true);
      }

      // call order: copy-forward first, manifest next, old-prefix deletes last
      const copyIdx = t.fake.ops.findIndex((o) => o.op === 'copyKey');
      const manifestIdx = t.fake.ops.findIndex(
        (o) => o.op === 'putObject' && o.key.endsWith('manifest.json'),
      );
      const deleteIdx = t.fake.ops.findIndex((o) => o.op === 'deleteKey');
      expect(copyIdx).toBeGreaterThanOrEqual(0);
      expect(manifestIdx).toBeGreaterThan(copyIdx);
      expect(deleteIdx).toBeGreaterThan(manifestIdx);
      // empty prune: every delete targets the old prefix, none prunes the new one
      for (const op of t.fake.ops.filter((o) => o.op === 'deleteKey')) {
        expect(op.key.startsWith(oldPrefix)).toBe(true);
      }
    });
  });

  describe('backupOverview orphans (Phase 1)', () => {
    async function deleteUserRowsKeepS3(userId: string): Promise<void> {
      await t.shareRepo.delete({ userId });
      await t.personRepo.delete({ userId });
      await t.assetRepo.delete({ userId });
      await t.fileRepo.delete({ userId });
      await t.albumRepo.delete({ userId });
      await deleteAccountRow(userId);
    }

    it('unions live + orphan rows with deleted flags sorted by email', async () => {
      const liveEmail = `live-${randomUUID()}@example.com`;
      const live = await backupOneFile(liveEmail);
      const orphanEmail = `orphan-${randomUUID()}@example.com`;
      const orphan = await backupOneFile(orphanEmail);
      await deleteUserRowsKeepS3(orphan.user.id);

      const { items: rows } = await t.svc.backupOverview();
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
      t.fake.objects.set(corrupt.manifestKey, Buffer.from('not-json{{{'));
      await deleteUserRowsKeepS3(corrupt.user.id);

      const unreadEmail = `unread-${randomUUID()}@example.com`;
      const unread = await backupOneFile(unreadEmail);
      await deleteUserRowsKeepS3(unread.user.id);
      const unreadKey = unread.manifestKey;
      const origGet = t.fake.getBuffer.bind(t.fake);
      t.fake.getBuffer = (key: string) => {
        if (key === unreadKey) {
          const err = new Error('injected unreadable');
          err.name = 'InternalError';
          throw err;
        }
        return origGet(key);
      };

      const bareId = randomUUID();
      const barePrefix = backupPrefix(`bare-${randomUUID()}@example.com`, bareId);
      t.fake.objects.set(`${barePrefix}originals/stray.bin`, Buffer.from('stray'));

      try {
        const { items: rows } = await t.svc.backupOverview();
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
        t.fake.getBuffer = origGet;
      }
    });
  });
});
