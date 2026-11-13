import { NotFoundException, ServiceUnavailableException, type Logger } from '@nestjs/common';
import type { AdminUserBackupSync } from '@photox/shared-types';
import { backupPrefix, findPrefixesForUserId, resolveBackupPrefix } from '@photox/shared-config';
import { errorMessage, errorName } from '../common/errors';
import type { User } from '../database/entities/user.entity';
import type { BackupStatusService } from './backup-status.service';
import type { BackupStorageIo } from './backup-storage-io';
import type { DeleteBackupResult, UserBackupManifest } from './backup.types';
import type { S3BackupService } from './s3-backup.service';

export class BackupPrefixService {
  constructor(
    private readonly storageIo: BackupStorageIo,
    private readonly statusService: BackupStatusService,
    private readonly s3: S3BackupService,
    private readonly logger: Logger,
  ) {}

  /**
   * Relocates a user's backup to the prefix for the CURRENT email after an
   * account edit (A6): copy-forward every stale same-userId prefix, patch the
   * manifest identity block to the live user row, HEAD-verify the new manifest,
   * and only then delete the old prefixes. The old prefix (and its manifest)
   * survives until the new manifest is verified — same crash-safe ordering as a
   * normal backup.
   *
   * Never throws, including when the target prefix itself cannot be computed
   * (loadEnv/zod failure, empty email/userId) — every path resolves to an
   * AdminUserBackupSync so callers report the failure instead of 500ing. Failures
   * are reported as `error`: an S3 outage (including a failed stale-prefix scan)
   * must never masquerade as the benign `reason: 'no-backup'`, which is reserved
   * for "no stale prefix and no manifest at the current prefix".
   *
   * `synced` means the backup now matches the live account; `moved` means the S3
   * prefix itself was relocated. A `synced: false` result is either benign or a
   * failure — never collapse the two: `reason: 'no-backup'` is the genuine
   * "nothing was ever backed up" case, while `error` reports a real problem
   * (stale-prefix scan/listing outage, unreadable manifest, copy or HEAD-verify
   * failure, unusable prefix).
   */
  async moveBackupPrefix(user: User): Promise<AdminUserBackupSync> {
    // computed outside the main try: a throw here must still return a result —
    // callers report the failure instead of 500ing
    let to: string;
    try {
      to = backupPrefix(user.email, user.id);
    } catch (err) {
      const message = errorMessage(err);
      this.logger.warn(`Backup prefix unusable for user ${user.id} (${message})`);
      return { synced: false, moved: false, to: '', error: message };
    }
    try {
      await this.s3.ensureBucket();
      let stale: string[] = [];
      try {
        stale = await this.findStalePrefixesForUser(user.id, to);
      } catch (err) {
        // a listing outage is a failure to report, not "this user has no backup"
        const message = errorMessage(err);
        this.logger.warn(
          `Stale prefix scan failed for user ${user.id} (${errorName(err)}) — reporting sync failure`,
        );
        return { synced: false, moved: false, to, error: `stale prefix scan failed: ${message}` };
      }
      for (const prefix of stale) {
        await this.s3.copyPrefix(prefix, to);
      }
      // bytes are copied first (copyPrefix skips manifests), so the new manifest
      // is either already there (prior move) or only under a stale prefix
      const manifestObjectKey = `${to}manifest.json`;
      const readMove = async (key: string): Promise<UserBackupManifest | null> => {
        const read = await this.storageIo.readManifest(key);
        if ('manifest' in read) return read.manifest;
        if (read.error === 'missing') this.logger.log(`No backup manifest at ${key}`);
        else this.logger.warn(`Backup manifest at ${key} ${read.error} (${errorName(read.cause)})`);
        return null;
      };
      let manifest = await readMove(manifestObjectKey);
      if (manifest === null) {
        for (const prefix of stale) {
          manifest = await readMove(`${prefix}manifest.json`);
          if (manifest !== null) break;
        }
      }
      if (manifest === null) {
        // stale prefixes carrying only bytes (no readable manifest) are an error:
        // the backup exists in some form, it just cannot be relocated safely
        if (stale.length > 0) {
          this.logger.warn(`Backup manifest unreadable for user ${user.id} (${to})`);
          return { synced: false, moved: false, to, error: 'backup manifest unreadable' };
        }
        this.logger.log(`No backup to move for user ${user.id} (${to})`);
        return { synced: false, moved: false, to, reason: 'no-backup' };
      }
      // bytes stay from the last backup; only the identity block must match the
      // live account so a later restore does not resurrect a stale email/hash
      const patched: UserBackupManifest = {
        ...manifest,
        emailAtBackup: user.email,
        user: {
          ...manifest.user,
          email: user.email,
          role: user.role,
          displayName: user.displayName,
          passwordHash: user.passwordHash,
          tokensValidAfter: user.tokensValidAfter
            ? new Date(user.tokensValidAfter).toISOString()
            : null,
        },
      };
      await this.s3.putObject(
        manifestObjectKey,
        Buffer.from(JSON.stringify(patched)),
        'application/json',
      );
      await this.s3.headObject(manifestObjectKey);
      // new manifest verified — the stale prefixes are now redundant copies
      await this.deletePrefixesQuietly(stale, user.id);
      this.logger.log(`Moved backup prefix for user ${user.id} to ${to}`);
      return stale.length > 0
        ? { synced: true, moved: true, from: stale[0]!, to }
        : { synced: true, moved: false, to };
    } catch (err) {
      const message = errorMessage(err);
      this.logger.warn(`Backup prefix move failed for user ${user.id} (${message})`);
      return { synced: false, moved: false, to, error: message };
    }
  }

  /**
   * Deletes one user's backup bytes from S3 (manifest + originals, every key
   * under the located prefix). Resolves live users by DB row and deleted users
   * by S3 scan via locateBackup; an empty prefix reads as 404 (no backup), S3
   * outages as 503. Never touches DB rows — the user/assets/files stay, only
   * S3 bytes go. Deleting a live user's backup is allowed (the row then reads
   * exists:false; the next backup recreates it).
   */
  async deleteBackup(emailOrId: string): Promise<DeleteBackupResult> {
    await this.storageIo.ensureStorage();
    let located: { prefix: string; manifestObjectKey: string; userId: string };
    try {
      located = await this.statusService.locateBackup(emailOrId);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    let keys: string[];
    try {
      keys = await this.s3.listKeys(located.prefix);
    } catch {
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    if (keys.length === 0) throw new NotFoundException(`No backup found for ${emailOrId}`);
    const email = await this.readDeleteBackupEmail(located);
    try {
      await this.s3.deleteKeys(keys);
    } catch {
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    this.logger.log(
      `Deleted backup ${located.prefix} for user ${located.userId} (${keys.length} object(s))`,
    );
    return { userId: located.userId, email, prefix: located.prefix, deletedObjects: keys.length };
  }

  /**
   * Backup-time email for a located backup: the manifest's emailAtBackup when
   * readable, else the email parsed back out of the located prefix (identical
   * except for a pending email-change rename, where the manifest wins). Never
   * throws: readManifest tags every failure and the prefix fallback is defined
   * in practice (located prefixes are always backupPrefix-built or dir-parsed).
   */
  private async readDeleteBackupEmail(located: {
    prefix: string;
    manifestObjectKey: string;
    userId: string;
  }): Promise<string> {
    const read = await this.storageIo.readManifest(located.manifestObjectKey);
    if ('manifest' in read) return read.manifest.emailAtBackup;
    return this.statusService.prefixIdentity(located).emailAtBackup ?? located.userId;
  }

  /**
   * Lists every stale same-userId prefix (old emails) excluding the current one,
   * via the shared findPrefixesForUserId helper over a base listing.
   */
  async findStalePrefixesForUser(userId: string, currentPrefix: string): Promise<string[]> {
    const base = resolveBackupPrefix();
    const keys = await this.s3.listKeys(base);
    return findPrefixesForUserId(keys, base, userId).filter(
      (prefix: string) => prefix !== currentPrefix,
    );
  }

  /**
   * Best-effort delete of whole backup prefixes: list, delete, log. A failure
   * leaves the prefix as an orphan for the next backup sweep — never throws.
   */
  async deletePrefixesQuietly(prefixes: string[], userId: string): Promise<void> {
    for (const prefix of prefixes) {
      try {
        const oldKeys = await this.s3.listKeys(prefix);
        if (oldKeys.length > 0) await this.s3.deleteKeys(oldKeys);
        this.logger.log(`Deleted old backup prefix ${prefix} for user ${userId}`);
      } catch (err) {
        this.logger.warn(
          `Failed to delete old backup prefix ${prefix} (${errorName(err)}) — leaving orphan`,
        );
      }
    }
  }

  /**
   * Lazy S3 rename: server-side copy-forward of every stale prefix into the
   * current prefix (manifests skipped — rewritten fresh after the upload loop).
   * Sequential per prefix; copyPrefix logs the per-prefix copy/skip counts.
   */
  async renameBackupPrefix(stalePrefixes: string[], newPrefix: string): Promise<void> {
    for (const stale of stalePrefixes) {
      await this.s3.copyPrefix(stale, newPrefix);
      this.logger.log(`Renamed backup prefix ${stale} -> ${newPrefix}`);
    }
  }
}
