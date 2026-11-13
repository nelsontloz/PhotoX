import { NotFoundException, ServiceUnavailableException, type Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { In, type Repository } from 'typeorm';
import {
  backupPrefix,
  manifestKey,
  normalizeEmail,
  parseBackupDir,
  resolveBackupPrefix,
} from '@photox/shared-config';
import type { Asset } from '../database/entities/asset.entity';
import type { BackupMerge } from '../database/entities/backup-merge.entity';
import type { BackupRun } from '../database/entities/backup-run.entity';
import type { User } from '../database/entities/user.entity';
import { isDerivativeStorageKey } from './backup-manifest';
import {
  buildBackupOverviewRow,
  buildOrphanBackupOverviewRow,
  pickNewest,
  snapshotFromStatus,
  timeOf,
  type BackupDirLocation,
} from './backup-overview.builder';
import type { BackupStorageIo } from './backup-storage-io';
import {
  userBackupManifestSchema,
  type BackupOverviewRow,
  type BackupProgress,
  type BackupSnapshot,
  type BackupStatus,
  type UserBackupManifest,
} from './backup.types';
import { isNotFound, type S3BackupService } from './s3-backup.service';

export class BackupStatusService {
  constructor(
    private readonly storageIo: BackupStorageIo,
    private readonly s3: S3BackupService,
    private readonly logger: Logger,
    private readonly users: Repository<User>,
    private readonly assets: Repository<Asset>,
    private readonly backupMerges: Repository<BackupMerge>,
    private readonly runs: Repository<BackupRun>,
  ) {}

  async backupStatus(emailOrId: string): Promise<BackupStatus> {
    await this.storageIo.ensureStorage();
    let located;
    try {
      located = await this.locateBackup(emailOrId);
    } catch (err) {
      if (err instanceof NotFoundException) return { exists: false };
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    return this.readBackupStatus(located);
  }

  /**
   * Manifest fetch + parse shared by backupStatus (per-user probe) and
   * backupOverview (batch path). Takes an already-resolved location — no
   * ensureBucket, no locateBackup LIST scan — so the overview can reuse its
   * single base listing and one hoisted ensureBucket. S3-down still throws
   * 503 (no partial table); a missing manifest reads as exists:false.
   */
  private async readBackupStatus(located: {
    prefix: string;
    manifestObjectKey: string;
    userId: string;
  }): Promise<BackupStatus> {
    let raw: Buffer;
    try {
      raw = await this.s3.getBuffer(located.manifestObjectKey);
    } catch (err) {
      if (isNotFound(err)) return { exists: false };
      const name = (err as { name?: string }).name ?? 'Unknown';
      try {
        await this.s3.headObject(located.manifestObjectKey);
      } catch (headErr) {
        if (isNotFound(headErr)) return { exists: false };
        throw new ServiceUnavailableException('Backup storage (S3) unreachable');
      }
      this.logger.warn(
        `Backup manifest at ${located.manifestObjectKey} unreadable (${name}) — ` +
          'object exists, reporting degraded status',
      );
      return { exists: true, degraded: 'unreadable', ...this.prefixIdentity(located) };
    }
    let manifest: UserBackupManifest;
    try {
      manifest = userBackupManifestSchema.parse(JSON.parse(raw.toString('utf-8')));
    } catch (err) {
      // never log the payload — the manifest carries the user's passwordHash
      const name = (err as { name?: string }).name ?? 'Unknown';
      this.logger.warn(
        `Backup manifest at ${located.manifestObjectKey} failed validation (${name}) — ` +
          'reporting degraded status',
      );
      return { exists: true, degraded: 'corrupt', ...this.manifestIdentity(raw, located) };
    }
    // Legacy manifests embed derivative rows — report original-only counts so a
    // pre-fix backup reads the same as the bytes a new backup would upload.
    const originalFiles = manifest.files.filter((f) => !isDerivativeStorageKey(f.storageKey));
    return {
      exists: true,
      userId: manifest.userId,
      emailAtBackup: manifest.emailAtBackup,
      role: manifest.user.role,
      backedUpAt: manifest.backedUpAt,
      files: originalFiles.length,
      assets: manifest.assets.length,
      albums: manifest.albums.length,
      shares: manifest.shares.length,
      persons: manifest.persons.length,
    };
  }

  /**
   * Admin backups-table overview: live users plus orphan (deleted-user) S3 prefixes.
   * Live rows join the DB asset count with a manifest snapshot (`deleted: false`);
   * orphan rows are S3-only (`deleted: true`, `totalAssets: 0`, identity from the
   * manifest/prefix with role fallback `user`). Manifest-less prefixes are skipped
   * at debug. S3-down throws 503 via the hoisted ensureBucket, the base listing,
   * or any manifest read (no partial table) so a red table never masquerades as
   * "nobody backed up".
   *
   * Email reconciliation: a deleted account's backup whose manifest email matches
   * a live account is reported as sub-row material in that live row's
   * `legacyBackups` (with its own merge timestamp) instead of showing as an
   * orphan — never as the main row's status, even when the live account has no
   * backup of its own. Main-row precedence per live user: exact own manifest,
   * then a stale same-userId prefix (email-change leftover), then the exact own
   * prefix as exists:false. Previous-account snapshots (different userId) are
   * never the main row.
   *
   * ponytail: O(users + prefixes) manifest GETs + one base listKeys + one
   * ensureBucket — fine for personal-library scale (tens of users); upgrade path
   * is batched getBuffers when user counts grow. Delimiter-style listing skipped:
   * the S3 wrapper exposes only full-prefix listKeys (no Delimiter/CommonPrefixes
   * path), so prefix-only enumeration would need a new op + fake parity.
   */
  async backupOverview(): Promise<BackupOverviewRow[]> {
    const users = await this.users.find({ order: { email: 'ASC' } });
    const liveIds = new Set(users.map((u) => u.id));
    const liveByEmail = new Set(users.map((u) => normalizeEmail(u.email)));
    const totalByUser = new Map<string, number>();
    if (users.length > 0) {
      const ids = users.map((u) => u.id);
      const counts = await this.assets
        .createQueryBuilder('a')
        .select('a."userId"', 'userId')
        .addSelect('COUNT(*)', 'count')
        .where('a."userId" IN (:...ids)', { ids })
        .groupBy('a."userId"')
        .getRawMany<{ userId: string; count: string }>();
      for (const row of counts) totalByUser.set(row.userId, Number(row.count));
    }
    await this.storageIo.ensureStorage();
    let base: string;
    let keys: string[];
    try {
      base = resolveBackupPrefix();
      keys = await this.s3.listKeys(base);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }

    // One location per manifest-bearing prefix dir. A dir without a manifest is
    // unusable here (no counts/email), so it never participates.
    const dirs = this.manifestDirs(keys, base);

    // Exact live prefixes are always probed even when the listing omitted them —
    // the DB row is authoritative for the current email layout. The promise cache
    // keeps one GET per manifest key when a live prefix is also in `dirs`.
    const exactLocations = users.map((u) => ({
      prefix: backupPrefix(u.email, u.id),
      manifestObjectKey: manifestKey(u.email, u.id),
      userId: u.id,
    }));
    const statusPromises = new Map<string, Promise<BackupStatus>>();
    const readStatus = (loc: {
      prefix: string;
      manifestObjectKey: string;
      userId: string;
    }): Promise<BackupStatus> => {
      const cached = statusPromises.get(loc.prefix);
      if (cached) return cached;
      const pending = this.readBackupStatus(loc);
      statusPromises.set(loc.prefix, pending);
      return pending;
    };
    try {
      await Promise.all([
        ...dirs.map((dir) => readStatus(dir)),
        ...exactLocations.map((loc) => readStatus(loc)),
      ]);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }

    const snapshotsByUser = new Map<string, BackupSnapshot[]>();
    const prefixEmailByPrefix = new Map<string, string>();
    for (const dir of dirs) {
      const status = await readStatus(dir);
      if (!status.exists) continue;
      prefixEmailByPrefix.set(dir.prefix, dir.email);
      const snapshot = snapshotFromStatus(dir.userId, dir.email, dir.prefix, status);
      const list = snapshotsByUser.get(dir.userId) ?? [];
      list.push(snapshot);
      snapshotsByUser.set(dir.userId, list);
    }
    // One snapshot per source account: stale email-change prefixes for the same
    // userId are fallback candidates, never separate rows.
    const newestByUser = new Map<string, BackupSnapshot>();
    for (const [userId, list] of snapshotsByUser) {
      newestByUser.set(userId, pickNewest(list));
    }

    const mergedAtByTarget = new Map<string, Map<string, string>>();
    if (liveIds.size > 0) {
      const ledger = await this.backupMerges.find({ where: { targetUserId: In([...liveIds]) } });
      for (const entry of ledger) {
        const mergedAt = entry.mergedAt.toISOString();
        const bySource = mergedAtByTarget.get(entry.targetUserId) ?? new Map<string, string>();
        bySource.set(entry.backupUserId, mergedAt);
        mergedAtByTarget.set(entry.targetUserId, bySource);
      }
    }

    const exactByUser = new Map(users.map((u, i) => [u.id, exactLocations[i]!]));
    const liveRows: BackupOverviewRow[] = [];
    for (const user of users) {
      const exactLoc = exactByUser.get(user.id)!;
      const exactStatus = await readStatus(exactLoc);
      const exactSnapshot = snapshotFromStatus(user.id, user.email, exactLoc.prefix, exactStatus);
      const staleOwn = (snapshotsByUser.get(user.id) ?? []).filter(
        (snapshot) => snapshot.prefix !== exactLoc.prefix,
      );
      const userEmail = normalizeEmail(user.email);
      const previousAccounts: BackupSnapshot[] = [];
      for (const [sourceId, snapshot] of newestByUser) {
        if (sourceId === user.id || liveIds.has(sourceId)) continue;
        // A corrupt/mismatched manifest can claim a live user's id; never surface a
        // live account's own backup as another account's previous snapshot.
        if (liveIds.has(snapshot.userId)) continue;
        if (normalizeEmail(snapshot.emailAtBackup) !== userEmail) continue;
        previousAccounts.push(snapshot);
      }
      previousAccounts.sort((a, b) => timeOf(b.backedUpAt) - timeOf(a.backedUpAt));

      // Main-row status is never a previous-account snapshot: the exact own prefix
      // when it exists; otherwise the newest stale same-userId prefix (email-change
      // leftover); otherwise the exact own prefix reads as exists:false.
      let primary = exactSnapshot;
      if (!exactStatus.exists && staleOwn.length > 0) {
        primary = pickNewest(staleOwn);
      }
      const ledger = mergedAtByTarget.get(user.id);
      const withMergedAt = (snapshot: BackupSnapshot): BackupSnapshot => {
        const mergedAt = ledger?.get(snapshot.userId);
        return mergedAt === undefined ? { ...snapshot } : { ...snapshot, mergedAt };
      };
      // Every email-matched previous account (different userId, source not live) is
      // sub-row material, newest first — even when the live account has no own
      // backup. Same-userId stale prefixes are own-account leftovers, not "previous
      // accounts", so they never land here.
      const row = buildBackupOverviewRow(
        user,
        totalByUser.get(user.id) ?? 0,
        {
          exists: primary.exists,
          userId: primary.userId,
          emailAtBackup: primary.emailAtBackup,
          backedUpAt: primary.backedUpAt ?? undefined,
          files: primary.files,
          assets: primary.assets,
          albums: primary.albums,
          shares: primary.shares,
          persons: primary.persons,
          ...(primary.degraded !== undefined ? { degraded: primary.degraded } : {}),
        },
        previousAccounts.map(withMergedAt),
      );
      if (normalizeEmail(primary.emailAtBackup) !== userEmail) {
        row.emailAtBackup = primary.emailAtBackup;
      }
      liveRows.push(row);
    }

    const orphanRows: BackupOverviewRow[] = [];
    for (const [sourceId, snapshot] of newestByUser) {
      if (liveIds.has(sourceId) || liveIds.has(snapshot.userId)) continue;
      if (liveByEmail.has(normalizeEmail(snapshot.emailAtBackup))) continue;
      const prefixEmail = prefixEmailByPrefix.get(snapshot.prefix) ?? snapshot.emailAtBackup;
      // Read the original status (cached) so manifest role/degraded flags survive
      // the snapshot projection — orphans have no live user row to supply them.
      const status = await readStatus({
        prefix: snapshot.prefix,
        manifestObjectKey: `${snapshot.prefix}manifest.json`,
        userId: sourceId,
      });
      orphanRows.push(buildOrphanBackupOverviewRow(prefixEmail, sourceId, status, snapshot.prefix));
    }

    // One non-terminal run per user: the admin page uses it to resume the spinner and the
    // per-file counters immediately after a reload (the run ledger outlives the browser).
    const activeRuns = await this.runs.find({
      where: { state: In(['running', 'paused', 'finalizing']) },
      order: { startedAt: 'DESC' },
    });
    const activeByUser = new Map<string, BackupRun>();
    for (const run of activeRuns) {
      if (!activeByUser.has(run.userId)) activeByUser.set(run.userId, run);
    }
    const all = [...liveRows, ...orphanRows].map((row) => {
      const run = activeByUser.get(row.userId);
      return run === undefined
        ? row
        : { ...row, activeRun: { id: run.id, kind: run.kind, state: run.state } };
    });
    all.sort((a, b) => a.email.localeCompare(b.email) || a.userId.localeCompare(b.userId));
    return all;
  }

  /**
   * Live per-file snapshot of the latest backup run for one user. Unknown users throw like
   * startBackup; known users with no run yet get an idle zero snapshot.
   */
  async getBackupProgress(emailOrId: string): Promise<BackupProgress> {
    const user = await this.findUser(emailOrId);
    if (!user) throw new NotFoundException(`No user for ${emailOrId}`);
    const run = await this.runs.findOne({
      where: { userId: user.id, kind: 'backup' },
      order: { startedAt: 'DESC' },
    });
    if (!run) {
      const now = new Date().toISOString();
      return {
        userId: user.id,
        inProgress: false,
        total: 0,
        completed: 0,
        uploaded: 0,
        skipped: 0,
        currentFile: undefined,
        startedAt: now,
        updatedAt: now,
      };
    }
    return {
      userId: user.id,
      inProgress: run.state === 'running' || run.state === 'finalizing',
      total: run.totalItems,
      completed: run.completedItems,
      uploaded: run.uploaded,
      skipped: run.skipped,
      currentFile: run.currentFile ?? undefined,
      startedAt: run.startedAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  /**
   * Best-effort identity for a degraded (unreadable) manifest: the userId from
   * the located prefix plus the backup-time email parsed back out of the
   * `<email>__<userId>` folder segment. Counts are omitted — the body never
   * arrived — and backedUpAt is unknowable without the manifest.
   */
  prefixIdentity(located: { prefix: string; userId: string }): {
    userId: string;
    emailAtBackup?: string;
  } {
    const identity: { userId: string; emailAtBackup?: string } = { userId: located.userId };
    try {
      const base = resolveBackupPrefix();
      const dir =
        base && located.prefix.startsWith(base)
          ? located.prefix.slice(base.length)
          : located.prefix;
      // parseBackupDir strips the folder's trailing slash itself
      const parsed = parseBackupDir(dir);
      if (parsed.userId === located.userId) identity.emailAtBackup = parsed.email;
    } catch {
      // email stays omitted — userId alone still identifies the backup
    }
    return identity;
  }

  /**
   * Best-effort identity for a corrupt manifest: identifying fields pulled from
   * the raw bytes where present (never the secret payload), falling back to the
   * prefix-derived email. Counts are omitted — a failed schema parse means no
   * count is trustworthy.
   */
  private manifestIdentity(
    raw: Buffer,
    located: { prefix: string; userId: string },
  ): { userId: string; emailAtBackup?: string; backedUpAt?: string } {
    const identity: { userId: string; emailAtBackup?: string; backedUpAt?: string } = {
      ...this.prefixIdentity(located),
    };
    try {
      const partial = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
      if (typeof partial.userId === 'string' && partial.userId.length > 0) {
        identity.userId = partial.userId;
      }
      if (typeof partial.emailAtBackup === 'string' && partial.emailAtBackup.length > 0) {
        identity.emailAtBackup = partial.emailAtBackup;
      }
      if (typeof partial.backedUpAt === 'string' && partial.backedUpAt.length > 0) {
        identity.backedUpAt = partial.backedUpAt;
      }
    } catch {
      // raw bytes are not JSON at all — prefix-derived identity stands
    }
    return identity;
  }

  // ---------------------------------------------------------------------------------------
  // Per-file transfer ledger: backup/restore items are claimed in small batches, retried
  // independently, and the run finalizes (manifest last, derivatives last) when none remain.
  // ---------------------------------------------------------------------------------------

  async findUser(emailOrId: string): Promise<User | null> {
    // M1: non-UUID email input must never reach the uuid-typed id lookup — Postgres
    // raises 22P02 (500) before the email fallback runs (precedent: assets.service
    // isUUID guard). UUIDs take the by-id fast path, everything else goes email-only.
    if (isUUID(emailOrId)) {
      const byId = await this.users.findOne({ where: { id: emailOrId } });
      if (byId) return byId;
    }
    return this.users.findOne({ where: { email: normalizeEmail(emailOrId) } });
  }

  /**
   * Resolves the S3 prefix for a user: exact DB-derived prefix when its manifest
   * exists (email-first layout), else a single S3 scan choosing the newest
   * matching manifest. A live user matches either a same-userId stale prefix
   * (email-change leftover) or an email-matched previous account (deleted and
   * re-created) — both are legitimate sources for status/delete/restore. When no
   * candidate exists the exact location is returned so callers can report
   * exists:false instead of erroring. Non-live input (deleted user) matches the
   * newest manifest by normalized prefix email or userId suffix. Suffix matching
   * splits folder names on the LAST `__` (emails may contain `__`; UUIDs never do).
   */
  async locateBackup(
    emailOrId: string,
  ): Promise<{ prefix: string; manifestObjectKey: string; userId: string }> {
    const user = await this.findUser(emailOrId);
    const base = resolveBackupPrefix();
    if (user) {
      const exact = {
        prefix: backupPrefix(user.email, user.id),
        manifestObjectKey: manifestKey(user.email, user.id),
        userId: user.id,
      };
      try {
        await this.s3.headObject(exact.manifestObjectKey);
        return exact;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      const keys = await this.s3.listKeys(base);
      const wantedEmail = normalizeEmail(user.email);
      const candidates: { dir: BackupDirLocation; status: BackupStatus }[] = [];
      for (const dir of this.manifestDirs(keys, base)) {
        if (dir.userId !== user.id && normalizeEmail(dir.email) !== wantedEmail) continue;
        const status = await this.readBackupStatus(dir);
        if (!status.exists) continue;
        // Manifest emailAtBackup is authoritative; prefix email covers degraded.
        if (dir.userId !== user.id) {
          const backupEmail = normalizeEmail(status.emailAtBackup ?? dir.email);
          if (backupEmail !== wantedEmail) continue;
        }
        candidates.push({ dir, status });
      }
      if (candidates.length === 0) return exact;
      return this.newestLocated(candidates);
    }
    if (emailOrId.includes('@')) {
      const keys = await this.s3.listKeys(base);
      const wantEmail = normalizeEmail(emailOrId);
      const emailCandidates: { dir: BackupDirLocation; status: BackupStatus }[] = [];
      for (const dir of this.manifestDirs(keys, base)) {
        // Manifest email is authoritative (a pending email-change rename can leave
        // the prefix dir on the old address); fall back to the prefix email.
        const status = await this.readBackupStatus(dir);
        if (!status.exists) continue;
        if (normalizeEmail(status.emailAtBackup ?? dir.email) !== wantEmail) continue;
        emailCandidates.push({ dir, status });
      }
      if (emailCandidates.length === 0) {
        throw new NotFoundException(`No backup found for ${emailOrId}`);
      }
      // Prefer readable manifests; all-unreadable still resolves the prefix so
      // deleteBackup can remove the bytes (old first-manifest behavior).
      const readable = emailCandidates.filter((candidate) => candidate.status.exists);
      return this.newestLocated(readable.length > 0 ? readable : emailCandidates);
    }
    const candidates = await this.locateBackupByUserId(emailOrId);
    if (candidates.length === 0) throw new NotFoundException(`No backup found for ${emailOrId}`);
    // Prefer readable manifests; all-unreadable still resolves the prefix so
    // deleteBackup can remove the bytes (old first-manifest behavior).
    const readable = candidates.filter((candidate) => candidate.status.exists);
    return this.newestLocated(readable.length > 0 ? readable : candidates);
  }

  /**
   * Every manifest-bearing backup dir owned by one userId (stale email-change
   * prefixes included), with its manifest status, from a single base listing.
   * Shared by the merge source scan and locateBackup's non-live userId branch.
   */
  async locateBackupByUserId(
    userId: string,
  ): Promise<{ dir: BackupDirLocation; status: BackupStatus }[]> {
    const base = resolveBackupPrefix();
    const keys = await this.s3.listKeys(base);
    const candidates: { dir: BackupDirLocation; status: BackupStatus }[] = [];
    for (const dir of this.manifestDirs(keys, base)) {
      if (dir.userId !== userId) continue;
      candidates.push({ dir, status: await this.readBackupStatus(dir) });
    }
    return candidates;
  }

  /** Every manifest-bearing backup dir under `base`, one per prefix. */
  private manifestDirs(keys: string[], base: string): BackupDirLocation[] {
    const dirs: BackupDirLocation[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      if (!key.startsWith(base) || !key.endsWith('/manifest.json')) continue;
      const rest = key.slice(base.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) continue;
      const dir = rest.slice(0, slash);
      const prefix = `${base}${dir}/`;
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      let parsed: { email: string; userId: string };
      try {
        parsed = parseBackupDir(dir);
      } catch {
        continue;
      }
      dirs.push({ prefix, manifestObjectKey: key, email: parsed.email, userId: parsed.userId });
    }
    return dirs;
  }

  private newestLocated(candidates: { dir: BackupDirLocation; status: BackupStatus }[]): {
    prefix: string;
    manifestObjectKey: string;
    userId: string;
  } {
    const best = pickNewest(
      candidates.map((candidate) => ({
        dir: candidate.dir,
        backedUpAt: candidate.status.backedUpAt,
      })),
    );
    return {
      prefix: best.dir.prefix,
      manifestObjectKey: best.dir.manifestObjectKey,
      userId: best.dir.userId,
    };
  }
}
