import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FaDatabase, FaMagnifyingGlass, FaSpinner } from 'react-icons/fa6'
import { isAxiosError } from 'axios'
import {
  AdminSection,
  AdminToast,
  GhostButton,
  PrimaryButton,
  ProgressBar,
  RefreshButton,
  StatusPill,
} from './ui'
import {
  loadBackupOverview,
  getBackupProgress,
  backupUser,
  backupPrefixPreview,
  type BackupOverviewRow,
  type BackupResult,
  type BackupProgress,
} from '../../api/admin'
import { ConfirmDialog, RoleBadge } from './shared'

// --- admin backups table -------------------------------------------------------------------
// One row per user: manifest status, backed-up counts, pending count and last run. Per-row
// Backup reuses the single-user confirm + inline-run flow; Backup-all walks the filtered list
// sequentially so multi-GB libraries never run concurrently in the API.

const PAGE_SIZE = 15

const S3_DOWN_HEADLINE = "Can't reach backup storage"
const S3_DOWN_BODY =
  "The S3 endpoint isn't responding — check that Floci is running (docker compose up -d floci), then retry."
const BACKUP_TIMEOUT_MESSAGE =
  'Timed out talking to the API — the backup store may be slow or down. Retry in a moment.'
const STATUS_LOAD_FALLBACK = "Couldn't load backup status."
const RUN_FALLBACK = 'Backup failed'

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

function isStoreDown(err: unknown): boolean {
  return (
    isAxiosError(err) &&
    (err.response?.status === 503 || !err.response || err.code === 'ECONNABORTED')
  )
}

/** Formats an ISO timestamp the way the rest of the admin console does, tolerating absence. */
function stamp(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function pendingOf(row: BackupOverviewRow): number {
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

export function BackupSection() {
  const [rows, setRows] = useState<BackupOverviewRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorIsStore, setLoadErrorIsStore] = useState(false)
  const [version, setVersion] = useState(0)

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [progressMap, setProgressMap] = useState<Record<string, BackupProgress | null>>({})
  const [unsupported, setUnsupported] = useState<Record<string, boolean>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({})
  const [lastResults, setLastResults] = useState<Record<string, BackupResult>>({})

  const [confirmUser, setConfirmUser] = useState<BackupOverviewRow | null>(null)
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
        if (!cancelled) setRows(next)
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
    const q = query.trim().toLowerCase()
    if (!rows || !q) return rows ?? []
    return rows.filter((r) => r.email.toLowerCase().includes(q))
  }, [rows, query])

  useEffect(() => {
    setPage(0)
  }, [query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const anyBusy = backupAllRunning || Object.values(busy).some(Boolean)

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

  const runAll = async () => {
    const targets = [...filtered]
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

  const backedUpCount = rows?.filter((r) => r.exists && !r.degraded && !r.unavailable).length ?? 0
  const pendingAssets = rows?.reduce((sum, r) => sum + pendingOf(r), 0) ?? 0

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
          <RefreshButton
            onClick={() => setVersion((v) => v + 1)}
            label="Refresh backup overview"
            disabled={loading || anyBusy}
          />
          <PrimaryButton
            onClick={() => setConfirmAll(true)}
            disabled={!rows || rows.length === 0 || loading || anyBusy}
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
            {backedUpCount.toLocaleString()} of {rows.length.toLocaleString()} backed up ·{' '}
            {pendingAssets.toLocaleString()} assets pending
          </p>
          {filtered.length === 0 ? (
            <div className="rounded-lg bg-surface-container p-12 text-center">
              <p className="text-xs text-on-surface-variant">
                No users match &ldquo;{query.trim()}&rdquo;.
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
                    const progress = progressMap[row.userId] ?? null
                    const showDeterminate =
                      progress && !unsupported[row.userId] && progress.total > 0
                    const pill = pillFor(row, rowErrors[row.userId] ?? null)
                    const last = lastResults[row.userId]
                    const allSkipped = last && last.files > 0 && (last.skipped ?? 0) === last.files
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
                              <div className="mt-1">
                                <RoleBadge role={row.role} />
                              </div>
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
                          <GhostButton
                            onClick={() => setConfirmUser(row)}
                            disabled={anyBusy}
                            ariaLabel={`Back up ${row.email}`}
                            icon={isBusy ? <FaSpinner className="animate-spin" /> : undefined}
                          >
                            {isBusy ? 'Backing up…' : 'Backup'}
                          </GhostButton>
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
                          {rowErrors[row.userId] && (
                            <p className="mt-1 text-[11px] text-status-error max-w-[240px] ml-auto">
                              {rowErrors[row.userId]}
                            </p>
                          )}
                          {allSkipped && (
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
        Backups run inline in the API — multi-GB libraries can take a while. Backup-all runs users
        one by one. Restore stays API-only.
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
          title={`Back up ${filtered.length} user${filtered.length === 1 ? '' : 's'}?`}
          confirmLabel="Back up all"
          onClose={() => setConfirmAll(false)}
          onConfirm={() => void runAll()}
        >
          <p className="text-sm text-slate-400 mt-2">
            Runs one backup after another{query.trim() ? ' for the filtered users' : ''}, in the API
            process, so large libraries take a while. Each user reuses its own S3 prefix and skips
            unchanged files.
          </p>
        </ConfirmDialog>
      )}
    </AdminSection>
  )
}
