import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { vi } from 'vitest';
import { backupPrefix, manifestKey, originalKey } from '@photox/shared-config';
import { buildFallbackEmail } from '../../src/backup/user-backup.service';
import {
  backupSingle,
  closeBackupTestApp,
  createBackupTestApp,
  t,
  deleteAccountRow,
  resetBackupDb,
  runRestore,
  wipeUserData,
} from './helpers/user-backup';

describe('user backup round-trip', () => {
  // 120s: boots its own Postgres pool from the run's template database
  beforeAll(createBackupTestApp, 120_000);
  afterAll(closeBackupTestApp);
  beforeEach(resetBackupDb);

  describe('restore collisions (Phase 1)', () => {
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
      await wipeUserData();
      const result = await runRestore(user.id);
      expect(result.userId).toBe(user.id);
      expect(result.email).toBe(email);
      expect(result.prefix).toBe(prefix);
      expect(result.reassignmentError).toBeUndefined();
      expect(result.restoredFrom).toMatchObject({ emailAtBackup: email, prefix });
      expect(result.restoredFrom.manifestObjectKey.endsWith('manifest.json')).toBe(true);
      // same email: no re-home — the source prefix keeps its bytes + manifest
      const keptKeys = await t.fake.listKeys(prefix);
      expect(keptKeys.some((k) => k.endsWith('manifest.json'))).toBe(true);
      expect(keptKeys.length).toBe(2);
      const row = await t.userRepo.findOneOrFail({ where: { id: user.id } });
      expect(row.email).toBe(email);
    });

    it('falls back to restored-<ms>-<orig> when the email is taken by another id', async () => {
      const origEmail = `reuse-${randomUUID()}@example.com`;
      const { user: orig, prefix } = await backupSingle(origEmail);
      const origId = orig.id;
      await t.shareRepo.delete({ userId: origId });
      await t.personRepo.delete({ userId: origId });
      await t.assetRepo.delete({ userId: origId });
      await t.fileRepo.delete({ userId: origId });
      await deleteAccountRow(origId);

      const other = await t.userRepo.save(
        t.userRepo.create({
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

      const restored = await t.userRepo.findOneOrFail({ where: { id: origId } });
      expect(restored.email).toBe(result.email);
      const holder = await t.userRepo.findOneOrFail({ where: { id: other.id } });
      expect(holder.email).toBe(origEmail);

      // old prefix fully swept, new prefix carries the manifest + original bytes
      await expect(t.fake.listKeys(prefix)).resolves.toEqual([]);
      const file = await t.fileRepo.findOneOrFail({ where: { userId: origId } });
      const newKeys = await t.fake.listKeys(restoredPrefix);
      expect(newKeys).toEqual(
        expect.arrayContaining([
          manifestKey(result.email, origId),
          originalKey(result.email, origId, file.id, 'bin'),
        ]),
      );
      const rehomed = JSON.parse(
        (await t.fake.getBuffer(manifestKey(result.email, origId))).toString('utf-8'),
      ) as { userId: string; emailAtBackup: string; user: { id: string; email: string } };
      expect(rehomed.emailAtBackup).toBe(result.email);
      expect(rehomed.user.email).toBe(result.email);
      expect(rehomed.userId).toBe(origId);
      expect(rehomed.user.id).toBe(origId);

      await expect(t.svc.backupStatus(origId)).resolves.toMatchObject({
        exists: true,
        userId: origId,
        emailAtBackup: result.email,
      });
    });

    it('uses an explicit restoreEmail instead of the manifest/fallback allocation', async () => {
      const origEmail = `explicit-${randomUUID()}@example.com`;
      const { user: orig, prefix } = await backupSingle(origEmail);
      const origId = orig.id;
      await t.fileRepo.delete({ userId: origId });
      await deleteAccountRow(origId);
      // manifest email reused by another live account: the default path would
      // allocate restored-<ms>-<orig>, but the explicit address must win instead
      const other = await t.userRepo.save(
        t.userRepo.create({
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
      const restored = await t.userRepo.findOneOrFail({ where: { id: origId } });
      expect(restored.email).toBe(requested);
      const holder = await t.userRepo.findOneOrFail({ where: { id: other.id } });
      expect(holder.email).toBe(origEmail);

      await expect(t.fake.listKeys(prefix)).resolves.toEqual([]);
      const file = await t.fileRepo.findOneOrFail({ where: { userId: origId } });
      const rehomed = JSON.parse(
        (await t.fake.getBuffer(manifestKey(requested, origId))).toString('utf-8'),
      ) as { userId: string; emailAtBackup: string; user: { id: string; email: string } };
      expect(rehomed.emailAtBackup).toBe(requested);
      expect(rehomed.user.email).toBe(requested);
      expect(rehomed.userId).toBe(origId);
      expect(rehomed.user.id).toBe(origId);
      expect(t.fake.objects.has(originalKey(requested, origId, file.id, 'bin'))).toBe(true);
    });

    it('keeps the source prefix and reports reassignmentError when re-home fails', async () => {
      const origEmail = `rehome-fail-${randomUUID()}@example.com`;
      const { user: orig, prefix } = await backupSingle(origEmail);
      const origId = orig.id;
      await t.shareRepo.delete({ userId: origId });
      await t.personRepo.delete({ userId: origId });
      await t.assetRepo.delete({ userId: origId });
      await t.fileRepo.delete({ userId: origId });
      await deleteAccountRow(origId);

      await t.userRepo.save(
        t.userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Email Reuse',
        }),
      );

      t.fake.failNextCopies = 1;
      const result = await runRestore(origId);
      // the restore itself still succeeded under the fallback email
      expect(result.userId).toBe(origId);
      expect(result.email).toMatch(/^restored-\d+-.*@example\.com$/);
      expect(result.reassignmentError).toBe('injected copyKey failure');
      expect(result.prefix).toBe(prefix);
      expect(result.restoredFrom.prefix).toBe(prefix);
      const restored = await t.userRepo.findOneOrFail({ where: { id: origId } });
      expect(restored.email).toBe(result.email);
      // source prefix intact (bytes + manifest), nothing written under the fallback prefix
      const keptKeys = await t.fake.listKeys(prefix);
      expect(keptKeys.some((k) => k.endsWith('manifest.json'))).toBe(true);
      expect(keptKeys.length).toBe(2);
      await expect(t.fake.listKeys(backupPrefix(result.email, origId))).resolves.toEqual([]);
    });

    it('rejects an explicit restoreEmail owned by another live user (409 email-taken)', async () => {
      const origEmail = `taken-${randomUUID()}@example.com`;
      const { user: orig } = await backupSingle(origEmail);
      const origId = orig.id;
      await t.fileRepo.delete({ userId: origId });
      await deleteAccountRow(origId);

      const holderEmail = `holder-${randomUUID()}@example.com`;
      const holder = await t.userRepo.save(
        t.userRepo.create({
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
      expect(await t.userRepo.findOne({ where: { id: origId } })).toBeNull();
      expect(await t.fileRepo.findOne({ where: { userId: origId } })).toBeNull();
      const stillHolding = await t.userRepo.findOneOrFail({ where: { id: holder.id } });
      expect(stillHolding.email).toBe(holderEmail);
      await expect(t.svc.backupStatus(origEmail)).resolves.toMatchObject({ exists: true });
    });

    it('retries the fallback with a suffix when the first candidate is taken', async () => {
      const origEmail = `retry-${randomUUID()}@example.com`;
      const { user: orig } = await backupSingle(origEmail);
      const origId = orig.id;
      await t.assetRepo.delete({ userId: origId });
      await t.fileRepo.delete({ userId: origId });
      await deleteAccountRow(origId);
      await t.userRepo.save(
        t.userRepo.create({
          email: origEmail,
          role: 'user',
          passwordHash: 'other-hash',
          displayName: 'Reuse Holder',
        }),
      );

      const fixedNow = 1720000000000;
      const firstCandidate = buildFallbackEmail(origEmail, fixedNow, 0);
      await t.userRepo.save(
        t.userRepo.create({
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
      await wipeUserData();
      const first = await runRestore(origId);
      expect(first.userId).toBe(origId);
      const caught = await runRestore(origId).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).message).toContain('already-restored');
    });
  });
});
