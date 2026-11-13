import { normalizeEmail } from '@photox/shared-config';
import type { User } from '../database/entities';
import type { BackupOverviewRow, BackupSnapshot, BackupStatus } from './backup.types';

export function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Live-order-first id-keyed union: a live entry always wins a collision. */
export function unionById<T extends { id: string }>(live: T[], adopted: T[]): T[] {
  const seen = new Set(live.map((item) => item.id));
  const merged = [...live];
  for (const item of adopted) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

/** Newest snapshot by backedUpAt; unreadable/corrupt snapshots sort last. Stable on ties. */
export function pickNewest<T extends { backedUpAt: string | null | undefined }>(items: T[]): T {
  let best = items[0]!;
  let bestTime = timeOf(best.backedUpAt);
  for (let i = 1; i < items.length; i++) {
    const candidate = items[i]!;
    const candidateTime = timeOf(candidate.backedUpAt);
    if (candidateTime > bestTime) {
      best = candidate;
      bestTime = candidateTime;
    }
  }
  return best;
}

export interface BackupDirLocation {
  prefix: string;
  manifestObjectKey: string;
  email: string;
  userId: string;
}

export function snapshotFromStatus(
  userId: string,
  prefixEmail: string,
  prefix: string,
  status: BackupStatus,
): BackupSnapshot {
  const snapshot: BackupSnapshot = {
    userId: status.userId ?? userId,
    emailAtBackup: status.emailAtBackup ?? prefixEmail,
    prefix,
    backedUpAt: status.backedUpAt ?? null,
    assets: status.assets ?? 0,
    files: status.files ?? 0,
    albums: status.albums ?? 0,
    shares: status.shares ?? 0,
    persons: status.persons ?? 0,
    exists: status.exists,
  };
  if (status.degraded !== undefined) snapshot.degraded = status.degraded;
  return snapshot;
}

/**
 * Pure row math for the admin backups overview: live DB count vs manifest
 * counts, with the notBackedUp clamp (a newer backup can hold more assets
 * than the live DB after deletes — never report a negative gap).
 */
export function buildBackupOverviewRow(
  user: Pick<User, 'id' | 'email' | 'role'>,
  totalAssets: number,
  status: BackupStatus,
  legacyBackups?: BackupSnapshot[],
): BackupOverviewRow {
  const backedUpAssets = status.assets ?? 0;
  const backedUpFiles = status.files ?? 0;
  const row: BackupOverviewRow = {
    userId: user.id,
    email: user.email,
    role: user.role,
    totalAssets,
    backedUpAssets,
    backedUpFiles,
    backedUpAt: status.backedUpAt ?? null,
    exists: status.exists,
    notBackedUp: Math.max(0, totalAssets - backedUpAssets),
    deleted: false,
    backedUpAlbums: status.albums ?? 0,
    backedUpShares: status.shares ?? 0,
    backedUpPersons: status.persons ?? 0,
  };
  if (status.degraded !== undefined) row.degraded = status.degraded;
  if (legacyBackups !== undefined && legacyBackups.length > 0) {
    row.legacyBackups = legacyBackups;
  }
  return row;
}

/**
 * Pure orphan-row builder for the admin backups overview: deleted users have no
 * live DB row, so the backup itself supplies identity (manifest email/role with
 * prefix fallbacks) and live counts are zero (notBackedUp clamps to 0).
 * `emailAtBackup` is set only when the prefix-dir email differs from the
 * manifest email (stale rename leftover) — normally omitted.
 */
export function buildOrphanBackupOverviewRow(
  prefixEmail: string,
  prefixUserId: string,
  status: BackupStatus,
  prefix?: string,
): BackupOverviewRow {
  const backupEmail = status.emailAtBackup ?? prefixEmail;
  const role = status.role ?? 'user';
  const userId = status.userId ?? prefixUserId;
  const row = buildBackupOverviewRow({ id: userId, email: backupEmail, role }, 0, status);
  row.deleted = true;
  row.totalAssets = 0;
  row.notBackedUp = 0;
  if (prefix !== undefined) row.prefix = prefix;
  if (
    status.emailAtBackup !== undefined &&
    normalizeEmail(status.emailAtBackup) !== normalizeEmail(prefixEmail)
  ) {
    row.emailAtBackup = status.emailAtBackup;
  }
  return row;
}

/**
 * Pure fallback-email builder for restore-after-email-reuse: `restored-<ms>-<local>@<domain>`
 * (`<local>@<domain>` is the backup-time email), lowercased via normalizeEmail so the
 * result stays a valid email. `attempt > 0` appends `-<attempt>` to the local part to
 * keep the address valid while guaranteeing uniqueness (callers loop until free).
 */
export function buildFallbackEmail(origEmail: string, nowMs: number, attempt = 0): string {
  const normalized = normalizeEmail(origEmail);
  const at = normalized.lastIndexOf('@');
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const baseLocal = `restored-${nowMs}-${local}`;
  const finalLocal = attempt === 0 ? baseLocal : `${baseLocal}-${attempt}`;
  return normalizeEmail(`${finalLocal}@${domain}`);
}
