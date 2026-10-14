import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FaDatabase,
  FaMagnifyingGlass,
  FaSpinner,
  FaTrashCan,
  FaTriangleExclamation,
} from 'react-icons/fa6'
import { isAxiosError } from 'axios'
import {
  AdminSection,
  AdminToast,
  GhostButton,
  PrimaryButton,
  ProgressBar,
  RefreshButton,
  StatusPill,
  cx,
} from './ui'
import {
  loadBackupOverview,
  getBackupProgress,
  backupUser,
  restoreUser,
  deleteBackup,
  backupPrefixPreview,
  type BackupOverviewRow,
  type BackupResult,
  type BackupProgress,
  type RestoreResult,
} from '../../api/admin'
import { ConfirmDialog, RoleBadge } from './shared'
import { Dialog, formInputClass } from '../../components/Dialog'

// --- admin backups table -------------------------------------------------------------------
// One row per user: manifest status, backed-up counts, pending count and last run. Per-row
// Backup reuses the single-user confirm + inline-run flow; Backup-all walks the filtered list
// sequentially so multi-GB libraries never run concurrently in the API. Deleted rows are
// orphan S3 backups whose account is gone: they show Restore instead of Backup, and
// Backup-all skips them. Live rows never show Restore (nothing to bring back).

const PAGE_SIZE = 15

type BackupFilter = 'all' | 'active' | 'deleted'

const S3_DOWN_HEADLINE = "Can't reach backup storage"
const S3_DOWN_BODY =
  "The S3 endpoint isn't responding — check that Floci is running (docker compose up -d floci), then retry."
const BACKUP_TIMEOUT_MESSAGE =
  'Timed out talking to the API — the backup store may be slow or down. Retry in a moment.'
const STATUS_LOAD_FALLBACK = "Couldn't load backup status."
const RUN_FALLBACK = 'Backup failed'
const RESTORE_FALLBACK = 'Restore failed'
const ALREADY_RESTORED_MESSAGE = 'That account is already back — the list was refreshed to show it.'
const RESTORE_MISSING_MESSAGE =
  'No backup found for that user — it may have been removed from storage.'
const RESTORE_CORRUPT_MESSAGE = 'That backup file is damaged and cannot be restored.'
const DELETE_FALLBACK = 'Delete failed'
const DELETE_MISSING_MESSAGE = 'No backup found — the list was refreshed.'

const DEGRADED_HINT: Record<string, string> = {
  unreadable: 'Listed but unreadable — rerun the backup to replace it.',
  corrupt: 'Manifest is corrupt — rerun the backup to replace it.',
}

/** 503 means S3/Floci is down; a timeout or no response means the store is slow. Never leak axios verbatim. */
function statusErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    if (err.response?.status === 503) return S3_DOWN_BODY
    if (!err.response || err.code === 'ECONNABORTED') return BACKUP_TIMEOUT_MESSAGE
  }
  return STATUS_LOAD_FALLBACK
}

function runErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    if (err.response?.status === 503) return S3_DOWN_BODY
    if (!err.response || err.code === 'ECONNABORTED') return BACKUP_TIMEOUT_MESSAGE
  }
  return RUN_FALLBACK
}

/** Delete failures use plain wording; a 404 means the manifest is already gone. */
function deleteErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    if (err.response?.status === 404) return DELETE_MISSING_MESSAGE
    if (err.response?.status === 503) return S3_DOWN_BODY
    if (!err.response || err.code === 'ECONNABORTED') return BACKUP_TIMEOUT_MESSAGE
  }
  return DELETE_FALLBACK
}

/** Restore failures use plain wording: 409 means the account is already back (list is stale). */
function restoreErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    if (err.response?.status === 409) return ALREADY_RESTORED_MESSAGE
    if (err.response?.status === 404) return RESTORE_MISSING_MESSAGE
    if (err.response?.status === 422) return RESTORE_CORRUPT_MESSAGE
    if (err.response?.status === 503) return S3_DOWN_BODY
    if (!err.response || err.code === 'ECONNABORTED') return BACKUP_TIMEOUT_MESSAGE
  }
  return RESTORE_FALLBACK
}

function isStoreDown(err: unknown): boolean {
  return (
    isAxiosError(err) &&
    (err.response?.status === 503 || !err.response || err.code === 'ECONNABORTED')
  )
}

/** Formats an ISO timestamp the way the rest of the admin console does, tolerating absence. */
function stamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** Deleted rows have no live library, so nothing is pending however big the manifest is. */
function pendingOf(row: BackupOverviewRow): number {
  if (row.deleted) return 0
  if (typeof row.notBackedUp === 'number') return Math.max(0, row.notBackedUp)
  return Math.max(0, (row.totalAssets ?? 0) - (row.backedUpAssets ?? 0))
}

function pillFor(
  row: BackupOverviewRow,
  error: string | null,
): { tone: 'ok' | 'warn' | 'muted'; label: string } {
  if (error ?? row.unavailable) return { tone: 'warn', label: 'Unavailable' }
  if (row.degraded === 'unreadable') return { tone: 'warn', label: 'Unreadable' }
  if (row.degraded === 'corrupt') return { tone: 'warn', label: 'Corrupt' }
  if (row.exists) return { tone: 'ok', label: 'Backed up' }
  return { tone: 'muted', label: 'None' }
}

// --- delete dialog ----------------------------------------------------------------------
// Mirrors the backup/restore confirms (S3 prefix preview + manifest counts) with the
// typed-DELETE gate from DeleteUserDialog: the parent owns the API call, the dialog only
// answers once DELETE is typed. Destructive stays last everywhere it appears.

function DeleteBackupDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: BackupOverviewRow
  onClose: () => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const confirmed = confirmText === 'DELETE'

  return (
    <Dialog
      title={`Delete backup for ${row.email}?`}
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
          This permanently removes this user&apos;s S3 backup. This can&apos;t be undone.
        </p>
        <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 break-all">
          {backupPrefixPreview(row.email, row.userId)}
        </code>
        <p className="text-sm text-slate-400">
          This backup holds {(row.backedUpAssets ?? 0).toLocaleString()} assets and{' '}
          {(row.backedUpFiles ?? 0).toLocaleString()} files
          {row.backedUpAt ? `, last backed up ${stamp(row.backedUpAt)}.` : '.'}
        </p>
        <p className="text-sm text-slate-400">
          {row.deleted
            ? 'The deleted account stays deleted.'
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
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
        >
          Cancel
        </button>
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
  )
}

export function BackupSection() {
  const [rows, setRows] = useState<BackupOverviewRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorIsStore, setLoadErrorIsStore] = useState(false)
  const [version, setVersion] = useState(0)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BackupFilter>('all')
  const [page, setPage] = useState(0)

  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [restoring, setRestoring] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const [progressMap, setProgressMap] = useState<Record<string, BackupProgress | null>>({})
  const [unsupported, setUnsupported] = useState<Record<string, boolean>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({})
  const [lastResults, setLastResults] = useState<Record<string, BackupResult>>({})

  const [confirmUser, setConfirmUser] = useState<BackupOverviewRow | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<BackupOverviewRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BackupOverviewRow | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [backupAllRunning, setBackupAllRunning] = useState(false)
  const [backupAllCursor, setBackupAllCursor] = useState<{ done: number; total: number } | null>(
    null,
  )

  const [toast, setToast] = useState<{
    key: number
    message: ReactNode
    tone: 'default' | 'error'
  } | null>(null)
  const notify = (message: ReactNode, tone: 'default' | 'error' = 'default') =>
    setToast((prev) => ({ key: (prev?.key ?? 0) + 1, message, tone }))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setLoadErrorIsStore(false)
    loadBackupOverview()
      .then(({ rows: next }) => {
        if (!cancelled) {
          setRows(next)
          // A 409 restore bumps version to refetch: the same-userId row comes back live,
          // so drop its "already back" row error once the reload lands. Rows still deleted
          // keep their errors; missing rows have nothing to show under.
          setRowErrors((prev) => {
            if (Object.keys(prev).length === 0) return prev
            const freshById = new Map(next.map((r) => [r.userId, r] as const))
            let changed = false
            const out = { ...prev }
            for (const id of Object.keys(prev)) {
              if (!prev[id]) continue
              if (!freshById.get(id)?.deleted) {
                out[id] = null
                changed = true
              }
            }
            return changed ? out : prev
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(statusErrorMessage(err))
          setLoadErrorIsStore(isStoreDown(err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [version])

  const filtered = useMemo(() => {
    const list = rows ?? []
    const q = query.trim().toLowerCase()
    return list.filter((r) => {
      if (filter === 'active' && r.deleted) return false
      if (filter === 'deleted' && !r.deleted) return false
      if (q && !r.email.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, query, filter])

  useEffect(() => {
    setPage(0)
  }, [query, filter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const anyBusy =
    backupAllRunning ||
    Object.values(busy).some(Boolean) ||
    Object.values(restoring).some(Boolean) ||
    Object.values(deleting).some(Boolean)
  // Backup-all covers live accounts only — orphan backups are restored, not re-backed-up.
  const liveTargets = useMemo(() => filtered.filter((r) => !r.deleted), [filtered])

  // Per-row progress: poll the progress endpoint once a second for every in-flight row.
  // A 404 means the core predates the endpoint — fall back to the indeterminate bar.
  useEffect(() => {
    const ids = Object.keys(busy).filter((id) => busy[id] && !unsupported[id])
    if (ids.length === 0) return
    let cancelled = false
    const poll = async (id: string) => {
      try {
        const snapshot = await getBackupProgress(id)
        if (!cancelled) setProgressMap((prev) => ({ ...prev, [id]: snapshot }))
      } catch (err: unknown) {
        if (cancelled) return
        if (isAxiosError(err) && err.response?.status === 404) {
          setUnsupported((prev) => ({ ...prev, [id]: true }))
        }
      }
    }
    ids.forEach((id) => void poll(id))
    const timer = setInterval(() => {
      ids.forEach((id) => void poll(id))
    }, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [busy, unsupported])

  const runOne = async (row: BackupOverviewRow): Promise<boolean> => {
    setBusy((prev) => ({ ...prev, [row.userId]: true }))
    setRowErrors((prev) => ({ ...prev, [row.userId]: null }))
    setProgressMap((prev) => ({ ...prev, [row.userId]: null }))
    setUnsupported((prev) => {
      const next = { ...prev }
      delete next[row.userId]
      return next
    })
    try {
      const res = await backupUser(row.userId)
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
      )
      setLastResults((prev) => ({ ...prev, [row.userId]: res }))
      const allSkipped = res.files > 0 && (res.skipped ?? 0) === res.files
      notify(
        `Backed up ${row.email} — ${res.files.toLocaleString()} files (${(res.uploaded ?? 0).toLocaleString()} new, ${(res.skipped ?? 0).toLocaleString()} unchanged)${allSkipped ? ' — nothing new.' : ''}`,
      )
      return true
    } catch (err: unknown) {
      const message = runErrorMessage(err)
      setRowErrors((prev) => ({ ...prev, [row.userId]: message }))
      notify(`Backup of ${row.email} failed — ${message}`, 'error')
      return false
    } finally {
      setBusy((prev) => ({ ...prev, [row.userId]: false }))
      setProgressMap((prev) => {
        const next = { ...prev }
        delete next[row.userId]
        return next
      })
    }
  }

  const runRestore = async (row: BackupOverviewRow): Promise<boolean> => {
    setRestoring((prev) => ({ ...prev, [row.userId]: true }))
    setRowErrors((prev) => ({ ...prev, [row.userId]: null }))
    try {
      const res: RestoreResult = await restoreUser(row.userId)
      notify(
        `Restored ${res.email} — ${res.assets.toLocaleString()} assets, ${res.files.toLocaleString()} files. Sign in as ${res.email}; the old password still works.`,
      )
      setVersion((v) => v + 1)
      return true
    } catch (err: unknown) {
      const message = restoreErrorMessage(err)
      setRowErrors((prev) => ({ ...prev, [row.userId]: message }))
      notify(`Restore of ${row.email} failed — ${message}`, 'error')
      if (isAxiosError(err) && err.response?.status === 409) setVersion((v) => v + 1)
      return false
    } finally {
      setRestoring((prev) => ({ ...prev, [row.userId]: false }))
    }
  }

  const runDelete = async (row: BackupOverviewRow): Promise<boolean> => {
    setDeleting((prev) => ({ ...prev, [row.userId]: true }))
    setRowErrors((prev) => ({ ...prev, [row.userId]: null }))
    try {
      const res = await deleteBackup(row.userId)
      notify(
        `Deleted backup for ${res.email} — ${res.deletedObjects.toLocaleString()} objects removed.`,
      )
      setVersion((v) => v + 1)
      return true
    } catch (err: unknown) {
      const message = deleteErrorMessage(err)
      setRowErrors((prev) => ({ ...prev, [row.userId]: message }))
      // A 404 means the manifest is already gone — the refreshed list is the recovery,
      // so the row error carries it without an extra failure toast.
      if (!isAxiosError(err) || err.response?.status !== 404) {
        notify(`Delete of ${row.email} failed — ${message}`, 'error')
      } else {
        setVersion((v) => v + 1)
      }
      return false
    } finally {
      setDeleting((prev) => ({ ...prev, [row.userId]: false }))
    }
  }

  const runAll = async () => {
    const targets = [...liveTargets]
    setConfirmAll(false)
    if (targets.length === 0) return
    setBackupAllRunning(true)
    setBackupAllCursor({ done: 0, total: targets.length })
    let ok = 0
    let failed = 0
    for (const target of targets) {
      const success = await runOne(target)
      if (success) ok += 1
      else failed += 1
      setBackupAllCursor({ done: ok + failed, total: targets.length })
    }
    notify(
      failed === 0
        ? `Backup-all finished — ${ok} user${ok === 1 ? '' : 's'} backed up.`
        : `Backup-all finished — ${ok} ok, ${failed} failed.`,
      failed === 0 ? 'default' : 'error',
    )
    setBackupAllRunning(false)
    setBackupAllCursor(null)
  }

  const backedUpCount = filtered.filter((r) => r.exists && !r.degraded && !r.unavailable).length
  const pendingAssets = filtered.reduce((sum, r) => sum + pendingOf(r), 0)
  const deletedCount = filtered.filter((r) => r.deleted).length

  return (
    <AdminSection
      title="User Backups"
      subtitle="Every account's rows and original files, copied to S3. Reruns reuse the same keys and skip unchanged files."
      icon={<FaDatabase />}
      actions={
        <>
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
          <RefreshButton
            onClick={() => setVersion((v) => v + 1)}
            label="Refresh backup overview"
            disabled={loading || anyBusy}
          />
          <PrimaryButton
            onClick={() => setConfirmAll(true)}
            disabled={liveTargets.length === 0 || loading || anyBusy}
            icon={backupAllRunning ? <FaSpinner className="animate-spin" /> : undefined}
            ariaLabel="Back up all users"
          >
            {backupAllRunning && backupAllCursor
              ? `Backing up ${Math.min(backupAllCursor.done + 1, backupAllCursor.total)}/${backupAllCursor.total}…`
              : 'Back up all'}
          </PrimaryButton>
        </>
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
          <GhostButton onClick={() => setVersion((v) => v + 1)}>Retry</GhostButton>
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
                    <th className="text-left font-semibold px-4 py-3">User</th>
                    <th className="text-left font-semibold px-4 py-3">Status</th>
                    <th className="text-left font-semibold px-4 py-3">Assets</th>
                    <th className="text-left font-semibold px-4 py-3">Files</th>
                    <th className="text-left font-semibold px-4 py-3">Pending</th>
                    <th className="text-left font-semibold px-4 py-3">Last backup</th>
                    <th className="text-right font-semibold px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark/60">
                  {paged.map((row) => {
                    const isBusy = Boolean(busy[row.userId])
                    const isRestoring = Boolean(restoring[row.userId])
                    const isDeleting = Boolean(deleting[row.userId])
                    const progress = progressMap[row.userId] ?? null
                    const showDeterminate =
                      progress && !unsupported[row.userId] && progress.total > 0
                    const pill = pillFor(row, rowErrors[row.userId] ?? null)
                    const last = lastResults[row.userId]
                    const allSkipped = last && last.files > 0 && (last.skipped ?? 0) === last.files
                    const emailHint =
                      row.emailAtBackup &&
                      row.emailAtBackup.toLowerCase() !== row.email.toLowerCase()
                        ? row.emailAtBackup
                        : null
                    return (
                      <tr
                        key={row.userId}
                        className="hover:bg-surface-container/50 transition-colors"
                      >
                        <td className="py-3 px-4">
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
                        <td className="py-3 px-4">
                          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                        </td>
                        <td className="py-3 px-4 tabular-nums text-on-surface">
                          {(row.backedUpAssets ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 tabular-nums text-on-surface">
                          {(row.backedUpFiles ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 tabular-nums text-on-surface-variant">
                          {pendingOf(row).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-outline whitespace-nowrap">
                          {stamp(row.backedUpAt)}
                        </td>
                        <td className="py-3 px-4 text-right align-top">
                          {row.deleted ? (
                            <div className="flex flex-col items-end gap-2">
                              <GhostButton
                                onClick={() => setConfirmRestore(row)}
                                disabled={anyBusy}
                                ariaLabel={`Restore ${row.email}`}
                                icon={
                                  isRestoring ? <FaSpinner className="animate-spin" /> : undefined
                                }
                              >
                                {isRestoring ? 'Restoring…' : 'Restore'}
                              </GhostButton>
                              <span title="That account is deleted — restore it before backing up.">
                                <GhostButton
                                  disabled
                                  ariaLabel={`Back up ${row.email} (deleted — restore first)`}
                                >
                                  Backup
                                </GhostButton>
                              </span>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(row)}
                                disabled={anyBusy}
                                title={`Delete backup for ${row.email}`}
                                aria-label={`Delete backup for ${row.email}`}
                                className={cx(
                                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                                  anyBusy
                                    ? 'text-outline/60 cursor-not-allowed'
                                    : 'text-status-error/80 hover:text-status-error hover:bg-status-error/10',
                                )}
                              >
                                {isDeleting ? (
                                  <FaSpinner className="animate-spin text-xs" aria-hidden="true" />
                                ) : (
                                  <FaTrashCan className="text-xs" aria-hidden="true" />
                                )}
                                {isDeleting ? 'Deleting…' : 'Delete'}
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-2">
                              <GhostButton
                                onClick={() => setConfirmUser(row)}
                                disabled={anyBusy}
                                ariaLabel={`Back up ${row.email}`}
                                icon={isBusy ? <FaSpinner className="animate-spin" /> : undefined}
                              >
                                {isBusy ? 'Backing up…' : 'Backup'}
                              </GhostButton>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(row)}
                                disabled={anyBusy}
                                title={`Delete backup for ${row.email}`}
                                aria-label={`Delete backup for ${row.email}`}
                                className={cx(
                                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                                  anyBusy
                                    ? 'text-outline/60 cursor-not-allowed'
                                    : 'text-status-error/80 hover:text-status-error hover:bg-status-error/10',
                                )}
                              >
                                {isDeleting ? (
                                  <FaSpinner className="animate-spin text-xs" aria-hidden="true" />
                                ) : (
                                  <FaTrashCan className="text-xs" aria-hidden="true" />
                                )}
                                {isDeleting ? 'Deleting…' : 'Delete'}
                              </button>
                            </div>
                          )}
                          {isBusy && (
                            <div
                              className="mt-2 min-w-[190px] max-w-[240px] ml-auto text-left"
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
                                    {progress.completed}/{progress.total} ({progress.uploaded} new,{' '}
                                    {progress.skipped} unchanged)
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
                              className="mt-2 min-w-[190px] max-w-[240px] ml-auto text-left"
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
                          {rowErrors[row.userId] && (
                            <p className="mt-1 text-[11px] text-status-error max-w-[240px] ml-auto">
                              {rowErrors[row.userId]}
                            </p>
                          )}
                          {allSkipped && !row.deleted && (
                            <p className="mt-1 text-[11px] text-outline">
                              Nothing new — already backed up.
                            </p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <footer className="bg-surface-container px-4 py-3 flex items-center justify-between gap-3 text-xs text-outline font-mono flex-wrap">
                <span>
                  Showing {paged.length.toLocaleString()} of {filtered.length.toLocaleString()} user
                  {filtered.length === 1 ? '' : 's'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                    className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-dark text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
                  >
                    Prev
                  </button>
                  <span className="px-2 tabular-nums">
                    Page {safePage + 1} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage + 1 >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                    className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-dark text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
                  >
                    Next
                  </button>
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
            const target = confirmUser
            setConfirmUser(null)
            void runOne(target)
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

      {confirmRestore && (
        <ConfirmDialog
          title={`Restore ${confirmRestore.email}?`}
          confirmLabel="Restore"
          onClose={() => setConfirmRestore(null)}
          onConfirm={() => {
            const target = confirmRestore
            setConfirmRestore(null)
            void runRestore(target)
          }}
        >
          <p className="text-sm text-slate-400 mt-2">
            Brings this deleted account back from its S3 backup — same files, albums, shares and
            people — then re-queues thumbnails and other processing. The restore runs now, in the
            API process, so large libraries take a while.
          </p>
          <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 mt-2 break-all">
            {backupPrefixPreview(confirmRestore.email, confirmRestore.userId)}
          </code>
          <p className="text-sm text-slate-400 mt-2">
            This backup holds {(confirmRestore.backedUpAssets ?? 0).toLocaleString()} assets and{' '}
            {(confirmRestore.backedUpFiles ?? 0).toLocaleString()} files
            {confirmRestore.backedUpAt
              ? `, last backed up ${stamp(confirmRestore.backedUpAt)}.`
              : '.'}
          </p>
          <p className="text-sm text-slate-400 mt-2">
            If that address is taken, it restores under a fallback like restored-&lt;time&gt;-
            {confirmRestore.email} instead — sign in with the address shown after the restore
            finishes. The restored account keeps its old password.
          </p>
        </ConfirmDialog>
      )}
      {confirmDelete && (
        <DeleteBackupDialog
          row={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete
            setConfirmDelete(null)
            void runDelete(target)
          }}
        />
      )}
    </AdminSection>
  )
}
