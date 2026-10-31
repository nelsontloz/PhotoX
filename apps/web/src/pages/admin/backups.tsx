import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FaArrowsRotate,
  FaCodeMerge,
  FaDatabase,
  FaMagnifyingGlass,
  FaSpinner,
  FaTrashCan,
  FaTriangleExclamation,
} from 'react-icons/fa6';
import { isAxiosError } from 'axios';
import { AdminSection, AdminToast, Button, ProgressBar, StatusPill, cx } from './ui';
import {
  getBackupOverview,
  getBackupProgress,
  backupUser,
  restoreUser,
  deleteBackup,
  mergeBackup,
  backupPrefixPreview,
  type BackupOverviewRow,
  type BackupResult,
  type BackupProgress,
  type RestoreResult,
  type BackupSnapshot,
} from '../../api/admin';
import { ConfirmDialog, RoleBadge } from './shared';
import { Dialog, formInputClass } from '../../components/Dialog';
import { useAsyncFetch } from '../../hooks/useAsyncFetch';
import { httpErrorMessage, type HttpErrorMessages } from './http-error';

// --- admin backups table -------------------------------------------------------------------
// One row per user: manifest status, backed-up counts, pending count and last run. Per-row
// Backup reuses the single-user confirm + inline-run flow; Backup-all walks the filtered list
// sequentially so multi-GB libraries never run concurrently in the API. Deleted rows are
// orphan S3 backups whose account is gone: they show Restore instead of Backup, and
// Backup-all skips them. Live rows never show Restore (nothing to bring back). Email-matched
// previous-account snapshots never take over the live row: each one (`legacyBackups`) gets
// its own sub-row underneath with Merge / Restore / Delete.

const PAGE_SIZE = 15;

type BackupFilter = 'all' | 'active' | 'deleted';

const S3_DOWN_HEADLINE = "Can't reach backup storage";
const S3_DOWN_BODY =
  "The S3 endpoint isn't responding — check that Floci is running (docker compose up -d floci), then retry.";
const BACKUP_TIMEOUT_MESSAGE =
  'Timed out talking to the API — the backup store may be slow or down. Retry in a moment.';
const STATUS_LOAD_FALLBACK = "Couldn't load backup status.";
const RUN_FALLBACK = 'Backup failed';
const RESTORE_FALLBACK = 'Restore failed';
const ALREADY_RESTORED_MESSAGE =
  'That account is already back — the list was refreshed to show it.';
const RESTORE_MISSING_MESSAGE =
  'No backup found for that user — it may have been removed from storage.';
const RESTORE_CORRUPT_MESSAGE = 'That backup file is damaged and cannot be restored.';
const RESTORE_EMAIL_TAKEN_MESSAGE = 'That email is already in use — choose another address.';
const RESTORE_INVALID_EMAIL_MESSAGE = "That email address isn't valid.";
const DELETE_FALLBACK = 'Delete failed';
const DELETE_MISSING_MESSAGE = 'No backup found — the list was refreshed.';
const MERGE_FALLBACK = 'Merge failed';
const MERGE_MISSING_MESSAGE =
  'No backup found for that previous account — it may have been removed from storage.';
const MERGE_ALREADY_MESSAGE = 'That backup was already merged into this account.';
const MERGE_EMAIL_MESSAGE =
  "The backup's email no longer matches this account — refresh the list and check the row.";
const MERGE_IN_PROGRESS_MESSAGE =
  'A merge for this account is already running — wait for it to finish.';
const MERGE_QUOTA_MESSAGE =
  'That backup is too large for the storage quota — free space and retry.';
const MERGE_CORRUPT_MESSAGE = 'That backup file is damaged and cannot be merged.';

const DEGRADED_HINT: Record<string, string> = {
  unreadable: 'Listed but unreadable — rerun the backup to replace it.',
  corrupt: 'Manifest is corrupt — rerun the backup to replace it.',
};

/** 503 means S3/Floci is down; a timeout or no response means the store is slow. Never leak axios verbatim. */
const STORE_ERRORS = { offline: S3_DOWN_BODY, timeout: BACKUP_TIMEOUT_MESSAGE } as const;

const STATUS_ERRORS: HttpErrorMessages = { fallback: STATUS_LOAD_FALLBACK, ...STORE_ERRORS };
const RUN_ERRORS: HttpErrorMessages = { fallback: RUN_FALLBACK, ...STORE_ERRORS };
/** Delete failures use plain wording; a 404 means the manifest is already gone. */
const DELETE_ERRORS: HttpErrorMessages = {
  fallback: DELETE_FALLBACK,
  byStatus: { 404: DELETE_MISSING_MESSAGE },
  ...STORE_ERRORS,
};
/**
 * Restore failures use plain wording: a 409 means the account is already back (list is stale)
 * unless its detail says the requested address is taken; a 400 means the typed address is
 * malformed and retrying the same one will not help.
 */
const RESTORE_ERRORS: HttpErrorMessages = {
  fallback: RESTORE_FALLBACK,
  byStatus: {
    409: ({ lower }) =>
      lower.includes('email-taken') ? RESTORE_EMAIL_TAKEN_MESSAGE : ALREADY_RESTORED_MESSAGE,
    400: RESTORE_INVALID_EMAIL_MESSAGE,
    404: RESTORE_MISSING_MESSAGE,
    422: RESTORE_CORRUPT_MESSAGE,
  },
  ...STORE_ERRORS,
};

const MERGE_CONFLICT_MESSAGE =
  'That backup cannot be merged into this account right now — refresh and retry.';

/** Merge failures use plain wording; 409 covers already-merged, email-mismatch and in-progress. */
const MERGE_ERRORS: HttpErrorMessages = {
  fallback: MERGE_FALLBACK,
  byStatus: {
    404: MERGE_MISSING_MESSAGE,
    409: ({ lower }) => {
      if (lower.includes('already-merged')) return MERGE_ALREADY_MESSAGE;
      if (lower.includes('email-mismatch')) return MERGE_EMAIL_MESSAGE;
      if (lower.includes('merge-in-progress')) return MERGE_IN_PROGRESS_MESSAGE;
      return MERGE_CONFLICT_MESSAGE;
    },
    413: MERGE_QUOTA_MESSAGE,
    422: MERGE_CORRUPT_MESSAGE,
  },
  ...STORE_ERRORS,
};

function isStoreDown(message: string | null): boolean {
  return message === S3_DOWN_BODY || message === BACKUP_TIMEOUT_MESSAGE;
}

/** Formats an ISO timestamp the way the rest of the admin console does, tolerating absence. */
function stamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/** Deleted rows have no live library, so nothing is pending however big the manifest is. */
function pendingOf(row: BackupOverviewRow): number {
  if (row.deleted) return 0;
  if (typeof row.notBackedUp === 'number') return Math.max(0, row.notBackedUp);
  return Math.max(0, (row.totalAssets ?? 0) - (row.backedUpAssets ?? 0));
}

/** Backup snapshot view of the row's own primary backup (plain live row or orphan). */
function rowSnapshot(row: BackupOverviewRow): BackupSnapshot {
  return {
    userId: row.userId,
    emailAtBackup: row.emailAtBackup ?? row.email,
    prefix: row.prefix ?? backupPrefixPreview(row.email, row.userId),
    backedUpAt: row.backedUpAt ?? null,
    assets: row.backedUpAssets ?? 0,
    files: row.backedUpFiles ?? 0,
    albums: row.backedUpAlbums ?? 0,
    shares: row.backedUpShares ?? 0,
    persons: row.backedUpPersons ?? 0,
  };
}

interface SnapshotLabels {
  merge: string;
  restore: string;
  delete: string;
}

/**
 * One per-row view-model: in-flight lanes, backup progress, the last failed sentence and the
 * last successful run all describe the same row, so they share one map keyed by the LIVE row's
 * userId (a snapshot action targets its own backupUserId but reports under the live row).
 */
interface RowState {
  busy?: boolean;
  restoring?: boolean;
  deleting?: boolean;
  merging?: boolean;
  progress?: BackupProgress | null;
  progressUnsupported?: boolean;
  error?: string | null;
  lastResult?: BackupResult;
}

/**
 * Aria labels double as the unique locator for each snapshot's actions. The first previous
 * account (index 0) keeps the short labels — its Delete says "previous" so it never collides
 * with the live row's own Delete — and later snapshots append their backup date.
 */
function snapshotLabels(
  row: BackupOverviewRow,
  snapshot: BackupSnapshot,
  legacy: boolean,
): SnapshotLabels {
  if (legacy) {
    const when = stamp(snapshot.backedUpAt);
    return {
      merge: `Merge to current live account ${row.email} (${when})`,
      restore: `Restore to a new account ${row.email} (${when})`,
      delete: `Delete previous backup for ${row.email} from ${when}`,
    };
  }
  return {
    merge: `Merge to current live account ${row.email}`,
    restore: `Restore to a new account ${row.email}`,
    delete: `Delete previous backup for ${row.email}`,
  };
}

function pillFor(
  row: BackupOverviewRow,
  error: string | null,
): { tone: 'ok' | 'warn' | 'muted'; label: string } {
  if (error ?? row.unavailable) return { tone: 'warn', label: 'Unavailable' };
  if (row.degraded === 'unreadable') return { tone: 'warn', label: 'Unreadable' };
  if (row.degraded === 'corrupt') return { tone: 'warn', label: 'Corrupt' };
  if (row.exists) return { tone: 'ok', label: 'Backed up' };
  return { tone: 'muted', label: 'None' };
}

// --- snapshot sub-rows ------------------------------------------------------------------
// A live row can carry previous-account backups matched by email (`legacyBackups`). Each
// snapshot renders as its own sub-row right under the live row with Merge / Restore / Delete,
// so the live row keeps its own status, counts and Backup action untouched.

function SnapshotSubRow({
  row,
  snapshot,
  legacy,
  anyBusy,
  deleting,
  onMerge,
  onRestore,
  onDelete,
}: {
  row: BackupOverviewRow;
  snapshot: BackupSnapshot;
  legacy: boolean;
  anyBusy: boolean;
  deleting: boolean;
  onMerge: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const labels = snapshotLabels(row, snapshot, legacy);
  const merged = Boolean(snapshot.mergedAt);

  return (
    <tr className="bg-surface-container/40">
      <td colSpan={7} className="py-3 px-3 sm:px-4">
        <div className="rounded-lg bg-surface-container border border-border-dark/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill tone="warn">Previous account</StatusPill>
            <code className="font-mono text-[10px] text-outline break-all">{snapshot.prefix}</code>
          </div>
          <table className="mt-2 w-full table-fixed text-[11px]">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-outline">
                <th className="w-1/6 font-semibold pr-3">Assets</th>
                <th className="w-1/6 font-semibold pr-3">Files</th>
                <th className="w-1/6 font-semibold pr-3">Albums</th>
                <th className="w-1/6 font-semibold pr-3">Shares</th>
                <th className="w-1/6 font-semibold pr-3">People</th>
                <th className="w-1/6 font-semibold pr-3">Last backup</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-on-surface">
                <td className="tabular-nums pr-3">{snapshot.assets.toLocaleString()}</td>
                <td className="tabular-nums pr-3">{snapshot.files.toLocaleString()}</td>
                <td className="tabular-nums pr-3">{snapshot.albums.toLocaleString()}</td>
                <td className="tabular-nums pr-3">{snapshot.shares.toLocaleString()}</td>
                <td className="tabular-nums pr-3">{snapshot.persons.toLocaleString()}</td>
                <td className="font-mono text-outline whitespace-nowrap pr-3">
                  {stamp(snapshot.backedUpAt)}
                </td>
              </tr>
            </tbody>
          </table>
          {merged && (
            <p className="mt-1 text-[11px] text-amber-300">Merged {stamp(snapshot.mergedAt)}</p>
          )}
          {/* Right-aligned action cluster: filled merge, outlined restore, red-outlined delete.
              Wraps on narrow screens instead of squeezing. */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {!merged && (
              // Button takes no title prop in its primary variant, so the hover title sits on the wrapper.
              <span className="inline-flex" title={`Merge this backup into ${row.email}`}>
                <Button
                  onClick={onMerge}
                  disabled={anyBusy}
                  ariaLabel={labels.merge}
                  icon={<FaCodeMerge />}
                >
                  Merge to current live account
                </Button>
              </span>
            )}
            <Button
              variant="outlinePrimary"
              onClick={onRestore}
              disabled={anyBusy}
              ariaLabel={labels.restore}
              title="Restore this backup as a separate account"
            >
              Restore to a new account
            </Button>
            <Button
              variant="dangerFlat"
              ariaLabel={labels.delete}
              title={labels.delete}
              disabled={anyBusy}
              size="md"
              onClick={onDelete}
              icon={
                deleting ? (
                  <FaSpinner className="animate-spin text-xs" aria-hidden="true" />
                ) : (
                  <FaTrashCan className="text-xs" aria-hidden="true" />
                )
              }
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// --- merge dialog -----------------------------------------------------------------------

function MergeBackupDialog({
  row,
  snapshot,
  onClose,
  onConfirm,
}: {
  row: BackupOverviewRow;
  snapshot: BackupSnapshot;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      title={`Merge backup into ${row.email}?`}
      confirmLabel="Merge"
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p className="text-sm text-slate-400 mt-2">
        Rebuilds this previous account&apos;s library inside the live account {row.email}. The live
        account keeps its email, password, role and display name.
      </p>
      <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 mt-2 break-all">
        {snapshot.prefix}
      </code>
      <p className="text-sm text-slate-400 mt-2">
        This backup holds {snapshot.assets.toLocaleString()} assets,{' '}
        {snapshot.files.toLocaleString()} files, {snapshot.albums.toLocaleString()} albums,{' '}
        {snapshot.shares.toLocaleString()} shares and {snapshot.persons.toLocaleString()} people
        {snapshot.backedUpAt ? `, last backed up ${stamp(snapshot.backedUpAt)}.` : '.'}
      </p>
      <p className="text-sm text-slate-400 mt-2">
        On success the snapshot is moved into the live account&apos;s own S3 backup: the live backup
        is updated (or created if it had none) and this previous-account entry disappears.
      </p>
      <p className="text-sm text-slate-400 mt-2">
        Duplicate photos are linked instead of copied. Albums and people with duplicate names are
        added as separate items. Old share links are restored when their token is free and skipped
        on conflict. Keep cleanup-orphans paused until the merge finishes.
      </p>
    </ConfirmDialog>
  );
}

// --- restore dialog ---------------------------------------------------------------------

function RestoreSnapshotDialog({
  row,
  snapshot,
  legacy,
  onClose,
  onConfirm,
}: {
  row: BackupOverviewRow;
  snapshot: BackupSnapshot;
  legacy: boolean;
  onClose: () => void;
  onConfirm: (restoreEmail?: string) => void;
}) {
  const [email, setEmail] = useState('');
  const title = legacy
    ? `Restore ${row.email} from ${stamp(snapshot.backedUpAt)}?`
    : `Restore ${row.email}?`;

  return (
    <ConfirmDialog
      title={title}
      confirmLabel="Restore"
      onClose={onClose}
      onConfirm={() => onConfirm(email.trim() || undefined)}
    >
      <p className="text-sm text-slate-400 mt-2">
        {row.deleted
          ? 'Brings this deleted account back from its S3 backup — same files, albums, shares and people — then re-queues thumbnails and other processing. The restore runs now, in the API process, so large libraries take a while.'
          : 'Brings this previous account back from its S3 backup — same files, albums, shares and people — then re-queues thumbnails and other processing. It creates a separate account and does not change the live account.'}
      </p>
      <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 mt-2 break-all">
        {snapshot.prefix}
      </code>
      <p className="text-sm text-slate-400 mt-2">
        This backup holds {snapshot.assets.toLocaleString()} assets and{' '}
        {snapshot.files.toLocaleString()} files
        {snapshot.backedUpAt ? `, last backed up ${stamp(snapshot.backedUpAt)}.` : '.'}
      </p>
      {snapshot.mergedAt && (
        <p className="text-sm text-amber-300 mt-2">
          This backup was already merged into the live account — restoring it duplicates the
          already-merged photos.
        </p>
      )}
      <p className="text-sm text-slate-400 mt-2">
        Sign in with the restored address; the restored account keeps its old password.
      </p>
      {/* The address ask closes the dialog body, right above Cancel / Restore, and opens focused. */}
      <div className="mt-4 rounded-lg border border-border-dark/70 bg-surface-container/40 p-3">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <label htmlFor="restore-new-email" className="block text-xs font-semibold text-slate-200">
            New account email
          </label>
          <span className="font-mono text-[10px] uppercase tracking-wider text-outline">
            Optional
          </span>
        </div>
        <input
          id="restore-new-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={snapshot.emailAtBackup}
          autoComplete="off"
          autoFocus
          className={formInputClass}
        />
        <p className="mt-1.5 text-xs text-slate-400">
          Leave empty to use the backup address; if it is taken, the account is restored as
          restored-&lt;time&gt;-&lt;address&gt;. Set a different address to restore under that
          email.
        </p>
      </div>
    </ConfirmDialog>
  );
}

// --- delete dialog ----------------------------------------------------------------------
// Mirrors the backup/restore confirms (S3 prefix preview + manifest counts) with the
// typed-DELETE gate from DeleteUserDialog: the parent owns the API call, the dialog only
// answers once DELETE is typed. Destructive stays last everywhere it appears.

function DeleteBackupDialog({
  row,
  snapshot,
  legacy = false,
  onClose,
  onConfirm,
}: {
  row: BackupOverviewRow;
  snapshot: BackupSnapshot;
  legacy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const confirmed = confirmText === 'DELETE';
  const previousSnapshot = !row.deleted && snapshot.userId !== row.userId;
  const title = legacy
    ? `Delete previous backup for ${row.email}?`
    : `Delete backup for ${row.email}?`;

  return (
    <Dialog
      title={title}
      onClose={onClose}
      ariaLabel="Delete backup confirmation"
      closeOnOverlay={false}
      escapeKey
      panelClassName="bg-card-dark border border-border-dark rounded-xl p-6 max-w-lg w-full"
      titleClassName="text-base font-semibold text-slate-100"
      icon={
        <span className="w-9 h-9 shrink-0 rounded-lg bg-status-error/10 flex items-center justify-center">
          <FaTriangleExclamation className="text-status-error text-base" />
        </span>
      }
    >
      <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-300">
          This permanently removes this snapshot&apos;s S3 backup. This can&apos;t be undone.
        </p>
        <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 break-all">
          {snapshot.prefix}
        </code>
        <p className="text-sm text-slate-400">
          This backup holds {snapshot.assets.toLocaleString()} assets and{' '}
          {snapshot.files.toLocaleString()} files
          {snapshot.backedUpAt ? `, last backed up ${stamp(snapshot.backedUpAt)}.` : '.'}
        </p>
        <p className="text-sm text-slate-400">
          {row.deleted
            ? 'The deleted account stays deleted.'
            : previousSnapshot
              ? 'The live account and any merged photos stay. If this was the only snapshot, the account shows as not backed up until the next backup.'
              : 'Only the S3 backup is removed; the account and its library stay, and the next Backup recreates it.'}
        </p>
        <div>
          <label
            htmlFor="delete-backup-confirm"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Type <span className="font-mono font-bold">DELETE</span> to confirm
          </label>
          <input
            id="delete-backup-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            autoFocus
            className={cx(formInputClass, 'font-mono tracking-widest')}
          />
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <Button variant="secondary" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!confirmed}
          className="inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-status-error/90 hover:bg-status-error rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Delete backup
        </button>
      </div>
    </Dialog>
  );
}

export function BackupSection() {
  const [version, setVersion] = useState(0);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BackupFilter>('all');
  const [page, setPage] = useState(0);

  // One per-row view-model: in-flight lanes, backup progress, the last failed sentence and the
  // last successful run all describe the same row, so they share one map keyed by the LIVE row's
  // userId (a snapshot action targets its own backupUserId but reports under the live row).
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const patchRow = useCallback(
    (id: string, patch: Partial<RowState>) =>
      setRowState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } })),
    [],
  );

  const [confirmUser, setConfirmUser] = useState<BackupOverviewRow | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{
    row: BackupOverviewRow;
    snapshot: BackupSnapshot;
    legacy: boolean;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    row: BackupOverviewRow;
    snapshot: BackupSnapshot;
    legacy: boolean;
  } | null>(null);
  const [confirmMerge, setConfirmMerge] = useState<{
    row: BackupOverviewRow;
    snapshot: BackupSnapshot;
  } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [backupAllRunning, setBackupAllRunning] = useState(false);
  const [backupAllCursor, setBackupAllCursor] = useState<{ done: number; total: number } | null>(
    null,
  );

  const [toast, setToast] = useState<{
    key: number;
    message: ReactNode;
    tone: 'default' | 'error';
  } | null>(null);
  const notify = (message: ReactNode, tone: 'default' | 'error' = 'default') =>
    setToast((prev) => ({ key: (prev?.key ?? 0) + 1, message, tone }));

  const {
    data,
    loading,
    error: loadError,
    setData: setRows,
  } = useAsyncFetch(
    async () => {
      try {
        const next = await getBackupOverview();
        // A 409 restore bumps version to refetch: the same-userId row comes back live, so drop
        // its "already back" row error once the reload lands. Rows still deleted keep their
        // errors; missing rows have nothing to show under.
        setRowState((prev) => {
          if (Object.keys(prev).length === 0) return prev;
          const freshById = new Map(next.map((r) => [r.userId, r] as const));
          let changed = false;
          const out = { ...prev };
          for (const id of Object.keys(prev)) {
            if (!prev[id]?.error) continue;
            if (!freshById.get(id)?.deleted) {
              out[id] = { ...out[id], error: null };
              changed = true;
            }
          }
          return changed ? out : prev;
        });
        return next;
      } catch (err) {
        throw new Error(httpErrorMessage(err, STATUS_ERRORS), { cause: err });
      }
    },
    { refreshKey: version, errorMessage: STATUS_LOAD_FALLBACK, loadingMode: 'always' },
  );
  const rows = data ?? null;
  const loadErrorIsStore = isStoreDown(loadError);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((r) => {
      if (filter === 'active' && r.deleted) return false;
      if (filter === 'deleted' && !r.deleted) return false;
      if (q && !r.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, filter]);

  useEffect(() => {
    setPage(0);
  }, [query, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const anyBusy =
    backupAllRunning ||
    Object.values(rowState).some(
      (s) => Boolean(s.busy) || Boolean(s.restoring) || Boolean(s.deleting) || Boolean(s.merging),
    );
  // Backup-all covers live accounts only — orphan backups are restored, not re-backed-up.
  const liveTargets = useMemo(() => filtered.filter((r) => !r.deleted), [filtered]);

  // Per-row progress: poll the progress endpoint once a second for every in-flight row.
  // A 404 means the core predates the endpoint — fall back to the indeterminate bar.
  const pollIds = Object.entries(rowState)
    .filter(([, state]) => state.busy && !state.progressUnsupported)
    .map(([id]) => id)
    .sort();
  // A stable string key keeps the interval alive across progress updates (only the set of
  // in-flight ids restarts it).
  const pollKey = pollIds.join('|');
  useEffect(() => {
    const ids = pollKey === '' ? [] : pollKey.split('|');
    if (ids.length === 0) return;
    let cancelled = false;
    const poll = async (id: string) => {
      try {
        const snapshot = await getBackupProgress(id);
        if (!cancelled) patchRow(id, { progress: snapshot });
      } catch (err: unknown) {
        if (cancelled) return;
        if (isAxiosError(err) && err.response?.status === 404) {
          patchRow(id, { progressUnsupported: true });
        }
      }
    };
    ids.forEach((id) => void poll(id));
    const timer = setInterval(() => {
      ids.forEach((id) => void poll(id));
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollKey, patchRow]);

  const runOne = async (row: BackupOverviewRow): Promise<boolean> => {
    patchRow(row.userId, { busy: true, error: null, progress: null, progressUnsupported: false });
    try {
      const res = await backupUser(row.userId);
      // A rerun can re-derive a row carrying previous-account snapshots, so re-read the
      // overview instead of optimistically patching it.
      if ((row.legacyBackups?.length ?? 0) > 0) {
        setVersion((v) => v + 1);
      } else {
        setRows((prev) =>
          (prev ?? []).map((r) =>
            r.userId === row.userId
              ? {
                  ...r,
                  exists: true,
                  degraded: undefined,
                  unavailable: undefined,
                  backedUpAssets: res.assets,
                  backedUpFiles: res.files,
                  backedUpAt: res.backedUpAt,
                }
              : r,
          ),
        );
      }
      patchRow(row.userId, { lastResult: res });
      const allSkipped = res.files > 0 && (res.skipped ?? 0) === res.files;
      notify(
        `Backed up ${row.email} — ${res.files.toLocaleString()} files (${(res.uploaded ?? 0).toLocaleString()} new, ${(res.skipped ?? 0).toLocaleString()} unchanged)${allSkipped ? ' — nothing new.' : ''}`,
      );
      return true;
    } catch (err: unknown) {
      const message = httpErrorMessage(err, RUN_ERRORS);
      patchRow(row.userId, { error: message });
      notify(`Backup of ${row.email} failed — ${message}`, 'error');
      return false;
    } finally {
      patchRow(row.userId, { busy: false, progress: null });
    }
  };

  const runRestore = async (
    row: BackupOverviewRow,
    snapshot: BackupSnapshot,
    restoreEmail?: string,
  ): Promise<boolean> => {
    patchRow(row.userId, { restoring: true, error: null });
    try {
      const res: RestoreResult = await restoreUser(snapshot.userId, restoreEmail);
      // A different restored address re-homes the S3 backup inline; a failed move does not fail
      // the restore — the next backup retries it through the email-change rename.
      const moveNote = res.reassignmentError
        ? ` The S3 backup could not be moved to ${res.email} — the next backup will finish the move.`
        : '';
      notify(
        `Restored ${res.email} — ${res.assets.toLocaleString()} assets, ${res.files.toLocaleString()} files. Sign in as ${res.email}; the old password still works.` +
          moveNote,
      );
      setVersion((v) => v + 1);
      return true;
    } catch (err: unknown) {
      const message = httpErrorMessage(err, RESTORE_ERRORS);
      patchRow(row.userId, { error: message });
      notify(`Restore of ${row.email} failed — ${message}`, 'error');
      if (isAxiosError(err) && err.response?.status === 409) setVersion((v) => v + 1);
      return false;
    } finally {
      patchRow(row.userId, { restoring: false });
    }
  };

  const runDelete = async (row: BackupOverviewRow, snapshot: BackupSnapshot): Promise<boolean> => {
    patchRow(row.userId, { deleting: true, error: null });
    try {
      const res = await deleteBackup(snapshot.userId);
      notify(
        `Deleted backup for ${res.email} — ${res.deletedObjects.toLocaleString()} objects removed.`,
      );
      setVersion((v) => v + 1);
      return true;
    } catch (err: unknown) {
      const message = httpErrorMessage(err, DELETE_ERRORS);
      patchRow(row.userId, { error: message });
      // A 404 means the manifest is already gone — the refreshed list is the recovery,
      // so the row error carries it without an extra failure toast.
      if (!isAxiosError(err) || err.response?.status !== 404) {
        notify(`Delete of ${row.email} failed — ${message}`, 'error');
      } else {
        setVersion((v) => v + 1);
      }
      return false;
    } finally {
      patchRow(row.userId, { deleting: false });
    }
  };

  const runMerge = async (row: BackupOverviewRow, snapshot: BackupSnapshot): Promise<boolean> => {
    patchRow(row.userId, { merging: true, error: null });
    try {
      const res = await mergeBackup({
        targetEmailOrId: row.userId,
        backupUserId: snapshot.userId,
        prefix: snapshot.prefix,
      });
      const shareSkips = res.skipped.shareTokenConflicts + res.skipped.shareTargetConflicts;
      // The rows are already merged; the S3 adoption is the follow-up step. Call out where the
      // backup ended up (or why it still needs a retry) instead of claiming a clean merge.
      const moveNote = res.assigned
        ? res.assigned.sourceDeleted
          ? ` The backup now belongs to ${row.email}.`
          : ` The backup now belongs to ${row.email}, but the old snapshot copy could not be removed.`
        : ' The library merged, but the backup could not be moved — retry the merge.';
      notify(
        `Merged ${res.merged.assets.toLocaleString()} assets (${res.deduped.assets.toLocaleString()} already present) into ${row.email}.` +
          (shareSkips > 0
            ? ` ${shareSkips.toLocaleString()} share link${shareSkips === 1 ? '' : 's'} skipped on conflict.`
            : '') +
          moveNote,
        res.assigned ? 'default' : 'error',
      );
      setVersion((v) => v + 1);
      return true;
    } catch (err: unknown) {
      const message = httpErrorMessage(err, MERGE_ERRORS);
      patchRow(row.userId, { error: message });
      notify(`Merge of ${row.email} failed — ${message}`, 'error');
      // A stale row (already merged elsewhere) is fixed by the refreshed overview;
      // an in-progress/email-mismatch 409 simply keeps the row as-is.
      if (isAxiosError(err) && err.response?.status === 409) setVersion((v) => v + 1);
      return false;
    } finally {
      patchRow(row.userId, { merging: false });
    }
  };

  const runAll = async () => {
    const targets = [...liveTargets];
    setConfirmAll(false);
    if (targets.length === 0) return;
    setBackupAllRunning(true);
    setBackupAllCursor({ done: 0, total: targets.length });
    let ok = 0;
    let failed = 0;
    for (const target of targets) {
      const success = await runOne(target);
      if (success) ok += 1;
      else failed += 1;
      setBackupAllCursor({ done: ok + failed, total: targets.length });
    }
    notify(
      failed === 0
        ? `Backup-all finished — ${ok} user${ok === 1 ? '' : 's'} backed up.`
        : `Backup-all finished — ${ok} ok, ${failed} failed.`,
      failed === 0 ? 'default' : 'error',
    );
    setBackupAllRunning(false);
    setBackupAllCursor(null);
  };

  const backedUpCount = filtered.filter((r) => r.exists && !r.degraded && !r.unavailable).length;
  const pendingAssets = filtered.reduce((sum, r) => sum + pendingOf(r), 0);
  const deletedCount = filtered.filter((r) => r.deleted).length;

  return (
    <AdminSection
      title="User Backups"
      subtitle="Every account's rows and original files, copied to S3. Reruns reuse the same keys and skip unchanged files."
      icon={<FaDatabase />}
      actions={
        // Phones: the row wraps onto its own line and stacks — a nowrap row squeezes the email
        // filter to ~50px and pushes Back up all past the card edge.
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-56">
            <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-xs pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by email…"
              aria-label="Filter backups by email"
              disabled={loading && !rows}
              className="w-full bg-surface-container border border-border-dark focus:border-primary/50 focus:ring-1 focus:ring-primary outline-none rounded-lg pl-9 pr-3 py-2 text-xs text-on-surface placeholder-outline transition-colors disabled:opacity-50"
            />
          </div>
          <div
            role="group"
            aria-label="Filter by account status"
            className="flex items-center rounded-lg bg-surface-container border border-border-dark p-0.5 text-xs font-semibold"
          >
            {(
              [
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'deleted', label: 'Deleted' },
              ] as { value: BackupFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={filter === opt.value}
                onClick={() => setFilter(opt.value)}
                className={
                  filter === opt.value
                    ? 'px-3 py-1.5 rounded-md bg-surface-container-highest text-on-surface'
                    : 'px-3 py-1.5 rounded-md text-on-surface-variant hover:text-on-surface transition-colors'
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button
            variant="icon"
            onClick={() => setVersion((v) => v + 1)}
            ariaLabel="Refresh backup overview"
            disabled={loading || anyBusy}
            className="inline-flex items-center justify-center p-2 rounded-lg border border-outline-variant bg-surface-container-highest text-on-surface-variant transition-colors enabled:hover:text-on-surface enabled:hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low disabled:opacity-50 disabled:cursor-not-allowed"
            icon={<FaArrowsRotate />}
          />
          <Button
            onClick={() => setConfirmAll(true)}
            disabled={liveTargets.length === 0 || loading || anyBusy}
            icon={backupAllRunning ? <FaSpinner className="animate-spin" /> : undefined}
            ariaLabel="Back up all users"
          >
            {backupAllRunning && backupAllCursor
              ? `Backing up ${Math.min(backupAllCursor.done + 1, backupAllCursor.total)}/${backupAllCursor.total}…`
              : 'Back up all'}
          </Button>
        </div>
      }
    >
      {backupAllRunning && backupAllCursor && (
        <div className="mb-4" role="status" aria-live="polite">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-on-surface">
            <FaSpinner className="animate-spin text-primary" />
            Backing up {backupAllCursor.done + 1} of {backupAllCursor.total}…
          </div>
          <ProgressBar
            value={backupAllCursor.done}
            max={backupAllCursor.total}
            label="Backup-all progress"
          />
        </div>
      )}

      {loading && !rows ? (
        <div className="space-y-2" aria-label="Loading backups">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-surface-container-high/50 animate-pulse" />
          ))}
        </div>
      ) : loadError && !rows ? (
        <div className="rounded-lg bg-surface-container p-6 text-center">
          {loadErrorIsStore ? (
            <>
              <p className="text-xs font-medium text-on-surface">{S3_DOWN_HEADLINE}</p>
              <p className="mt-1 mb-3 text-xs text-on-surface-variant">{S3_DOWN_BODY}</p>
            </>
          ) : (
            <p className="text-xs text-status-error mb-3">{loadError}</p>
          )}
          <Button variant="ghost" onClick={() => setVersion((v) => v + 1)}>
            Retry
          </Button>
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-lg bg-surface-container p-12 text-center">
          <p className="text-xs text-on-surface-variant">No users yet — nothing to back up.</p>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] text-outline mb-3">
            {backedUpCount.toLocaleString()} of {filtered.length.toLocaleString()} backed up ·{' '}
            {pendingAssets.toLocaleString()} assets pending
            {filter !== 'all' || deletedCount > 0
              ? ` · ${deletedCount.toLocaleString()} deleted`
              : ''}
          </p>
          {filtered.length === 0 ? (
            <div className="rounded-lg bg-surface-container p-12 text-center">
              <p className="text-xs text-on-surface-variant">
                {filter === 'deleted' && !query.trim()
                  ? 'No deleted backups — removed accounts keep their S3 copy here when one exists.'
                  : filter === 'active' && !query.trim()
                    ? 'No active accounts match this view.'
                    : `No users match “${query.trim()}”.`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl bg-surface-container-low border border-border-dark/60">
              <table className="w-full text-xs min-w-[780px]">
                <thead className="bg-surface-container text-on-surface-variant font-mono text-label-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-semibold px-3 py-3 sm:px-4">User</th>
                    <th className="text-left font-semibold px-3 py-3 sm:px-4">Status</th>
                    <th className="text-left font-semibold px-3 py-3 sm:px-4">Assets</th>
                    <th className="text-left font-semibold px-3 py-3 sm:px-4">Files</th>
                    <th className="text-left font-semibold px-3 py-3 sm:px-4">Pending</th>
                    <th className="text-left font-semibold px-3 py-3 sm:px-4">Last backup</th>
                    <th className="text-right font-semibold px-3 py-3 sm:px-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark/60">
                  {paged.map((row) => {
                    const state = rowState[row.userId];
                    const isBusy = Boolean(state?.busy);
                    const isRestoring = Boolean(state?.restoring);
                    const isDeleting = Boolean(state?.deleting);
                    // Previous-account snapshots render as sub-rows under this one. Orphan
                    // rows never carry them and keep their action shape exactly as before.
                    const legacySnapshots = row.deleted ? [] : (row.legacyBackups ?? []);
                    const progress = state?.progress ?? null;
                    const showDeterminate =
                      progress && !state?.progressUnsupported && progress.total > 0;
                    const pill = pillFor(row, state?.error ?? null);
                    const last = state?.lastResult;
                    const allSkipped = last && last.files > 0 && (last.skipped ?? 0) === last.files;
                    const emailHint =
                      row.emailAtBackup &&
                      row.emailAtBackup.toLowerCase() !== row.email.toLowerCase()
                        ? row.emailAtBackup
                        : null;
                    const openRestore = (snapshot: BackupSnapshot, legacy: boolean) =>
                      setConfirmRestore({ row, snapshot, legacy });
                    const openDelete = (snapshot: BackupSnapshot, legacy: boolean) =>
                      setConfirmDelete({ row, snapshot, legacy });
                    // Live and deleted rows differ only in the backup slot; Delete is identical.
                    const rowActions = (backup: ReactNode) => (
                      <div className="flex flex-col items-end gap-2">
                        {backup}
                        <Button
                          variant="danger"
                          title={`Delete backup for ${row.email}`}
                          ariaLabel={`Delete backup for ${row.email}`}
                          disabled={anyBusy}
                          onClick={() => openDelete(rowSnapshot(row), false)}
                          icon={
                            isDeleting ? (
                              <FaSpinner className="animate-spin text-xs" aria-hidden="true" />
                            ) : (
                              <FaTrashCan className="text-xs" aria-hidden="true" />
                            )
                          }
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </Button>
                      </div>
                    );
                    return (
                      <Fragment key={row.userId}>
                        <tr className="hover:bg-surface-container/50 transition-colors">
                          <td className="py-3 px-3 sm:px-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="w-7 h-7 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-[11px] font-bold flex items-center justify-center">
                                {(row.email.charAt(0) || '?').toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="font-mono text-xs text-on-surface truncate">
                                  {row.email}
                                </p>
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  <RoleBadge role={row.role} />
                                  {row.deleted && <StatusPill tone="warn">Deleted user</StatusPill>}
                                </div>
                                {emailHint && (
                                  <p className="mt-1 text-[11px] text-outline">
                                    Backup saved as {emailHint}
                                  </p>
                                )}
                                {row.degraded && (
                                  <p className="mt-1 text-[11px] text-amber-300">
                                    {DEGRADED_HINT[row.degraded]}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3 sm:px-4">
                            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                          </td>
                          <td className="py-3 px-3 sm:px-4 tabular-nums text-on-surface">
                            {(row.backedUpAssets ?? 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 sm:px-4 tabular-nums text-on-surface">
                            {(row.backedUpFiles ?? 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 sm:px-4 tabular-nums text-on-surface-variant">
                            {pendingOf(row).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 sm:px-4 font-mono text-[11px] text-outline whitespace-nowrap">
                            {stamp(row.backedUpAt)}
                          </td>
                          <td className="py-3 px-3 sm:px-4 text-right align-top">
                            {row.deleted
                              ? rowActions(
                                  <>
                                    <Button
                                      variant="secondary"
                                      tone="accent"
                                      onClick={() => openRestore(rowSnapshot(row), false)}
                                      disabled={anyBusy}
                                      ariaLabel={`Restore ${row.email}`}
                                      icon={
                                        isRestoring ? (
                                          <FaSpinner className="animate-spin" />
                                        ) : undefined
                                      }
                                    >
                                      {isRestoring ? 'Restoring…' : 'Restore'}
                                    </Button>
                                    <span title="That account is deleted — restore it before backing up.">
                                      <Button
                                        variant="secondary"
                                        disabled
                                        ariaLabel={`Back up ${row.email} (deleted — restore first)`}
                                      >
                                        Backup
                                      </Button>
                                    </span>
                                  </>,
                                )
                              : rowActions(
                                  <Button
                                    variant="secondary"
                                    tone="accent"
                                    onClick={() => setConfirmUser(row)}
                                    disabled={anyBusy}
                                    ariaLabel={`Back up ${row.email}`}
                                    icon={
                                      isBusy ? <FaSpinner className="animate-spin" /> : undefined
                                    }
                                  >
                                    {isBusy ? 'Backing up…' : 'Backup'}
                                  </Button>,
                                )}
                            {isBusy && (
                              <div
                                className="mt-2 w-full max-w-[240px] ml-auto text-left sm:min-w-[190px]"
                                role="status"
                                aria-live="polite"
                              >
                                {showDeterminate ? (
                                  <>
                                    <ProgressBar
                                      value={progress.completed}
                                      max={progress.total}
                                      label={`Backup progress for ${row.email}`}
                                    />
                                    <p className="mt-1 text-[11px] text-on-surface-variant">
                                      {progress.completed}/{progress.total} ({progress.uploaded}{' '}
                                      new, {progress.skipped} unchanged)
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                                      <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
                                    </div>
                                    <p className="mt-1 text-[11px] text-on-surface-variant">
                                      Backing up {row.email}…
                                    </p>
                                  </>
                                )}
                              </div>
                            )}
                            {isRestoring && (
                              <div
                                className="mt-2 w-full max-w-[240px] ml-auto text-left sm:min-w-[190px]"
                                role="status"
                                aria-live="polite"
                              >
                                <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                                  <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
                                </div>
                                <p className="mt-1 text-[11px] text-on-surface-variant">
                                  Restoring {row.email}…
                                </p>
                              </div>
                            )}
                            {state?.error && (
                              <p className="mt-1 text-[11px] text-status-error max-w-[240px] ml-auto">
                                {state.error}
                              </p>
                            )}
                            {allSkipped && !row.deleted && (
                              <p className="mt-1 text-[11px] text-outline">
                                Nothing new — already backed up.
                              </p>
                            )}
                          </td>
                        </tr>
                        {legacySnapshots.map((snap, index) => (
                          <SnapshotSubRow
                            key={`${snap.userId}-${snap.prefix}-${snap.backedUpAt ?? ''}`}
                            row={row}
                            snapshot={snap}
                            legacy={index > 0}
                            anyBusy={anyBusy}
                            deleting={isDeleting}
                            onMerge={() => setConfirmMerge({ row, snapshot: snap })}
                            onRestore={() => openRestore(snap, index > 0)}
                            onDelete={() => openDelete(snap, index > 0)}
                          />
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <footer className="bg-surface-container px-4 py-3 flex items-center justify-between gap-3 text-xs text-outline font-mono flex-wrap">
                <span>
                  Showing {paged.length.toLocaleString()} of {filtered.length.toLocaleString()} user
                  {filtered.length === 1 ? '' : 's'}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Prev
                  </Button>
                  <span className="px-2 tabular-nums">
                    Page {safePage + 1} of {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={safePage + 1 >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </footer>
            </div>
          )}
        </>
      )}

      <p className="text-body-sm text-on-surface-variant max-w-lg mt-4">
        Backups run inline in the API — multi-GB libraries can take a while. Backup-all runs live
        accounts one by one and skips deleted rows. Restoring a deleted backup brings the account
        back with its files.
      </p>

      {toast && <AdminToast key={toast.key} message={toast.message} tone={toast.tone} />}

      {confirmUser && (
        <ConfirmDialog
          title={`Back up ${confirmUser.email}?`}
          onClose={() => setConfirmUser(null)}
          onConfirm={() => {
            const target = confirmUser;
            setConfirmUser(null);
            void runOne(target);
          }}
        >
          <p className="text-sm text-slate-400 mt-2">
            Copies this user&apos;s rows and original files to S3 under the prefix below. The backup
            runs now, in the API process, so large libraries take a while.
          </p>
          <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 mt-2 break-all">
            {backupPrefixPreview(confirmUser.email, confirmUser.userId)}
          </code>
        </ConfirmDialog>
      )}

      {confirmAll && (
        <ConfirmDialog
          title={`Back up ${liveTargets.length} user${liveTargets.length === 1 ? '' : 's'}?`}
          confirmLabel="Back up all"
          onClose={() => setConfirmAll(false)}
          onConfirm={() => void runAll()}
        >
          <p className="text-sm text-slate-400 mt-2">
            Runs one backup after another{query.trim() ? ' for the filtered users' : ''}, in the API
            process, so large libraries take a while. Each user reuses its own S3 prefix and skips
            unchanged files.
            {filtered.length !== liveTargets.length &&
              ' Deleted backups are skipped — restore them first.'}
          </p>
        </ConfirmDialog>
      )}

      {confirmMerge && (
        <MergeBackupDialog
          row={confirmMerge.row}
          snapshot={confirmMerge.snapshot}
          onClose={() => setConfirmMerge(null)}
          onConfirm={() => {
            const target = confirmMerge;
            setConfirmMerge(null);
            void runMerge(target.row, target.snapshot);
          }}
        />
      )}
      {confirmRestore && (
        <RestoreSnapshotDialog
          row={confirmRestore.row}
          snapshot={confirmRestore.snapshot}
          legacy={confirmRestore.legacy}
          onClose={() => setConfirmRestore(null)}
          onConfirm={(restoreEmail) => {
            const target = confirmRestore;
            setConfirmRestore(null);
            void runRestore(target.row, target.snapshot, restoreEmail);
          }}
        />
      )}
      {confirmDelete && (
        <DeleteBackupDialog
          row={confirmDelete.row}
          snapshot={confirmDelete.snapshot}
          legacy={confirmDelete.legacy}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            void runDelete(target.row, target.snapshot);
          }}
        />
      )}
    </AdminSection>
  );
}
