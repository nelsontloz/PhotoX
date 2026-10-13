import { useEffect, useState } from 'react'
import { FaDatabase, FaMagnifyingGlass, FaSpinner } from 'react-icons/fa6'
import { type AdminUserRow } from '@photox/shared-types'
import {
  AdminSection,
  AdminToast,
  GhostButton,
  PrimaryButton,
  RefreshButton,
  StatStrip,
  StatusPill,
  cx,
} from './ui'
import {
  listAdminUsers,
  getBackupStatus,
  backupUser,
  backupPrefixPreview,
  type ListAdminUsersParams,
  type BackupResult,
  type BackupStatus,
} from '../../api/admin'
import { ConfirmDialog, RoleBadge } from './shared'

// --- user backups ------------------------------------------------------------------------

const PICK_LIMIT = 8
const PICK_DEBOUNCE_MS = 250

/** Formats an ISO timestamp the way the rest of the admin console does, tolerating absence. */
function stamp(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/**
 * Per-user S3 backup: searchable picker (debounced listAdminUsers), existing-backup status for
 * the selection, and a confirmed run with live disabled/progress state. Restore stays API-only.
 */
export function BackupSection() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<AdminUserRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminUserRow | null>(null)

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusVersion, setStatusVersion] = useState(0)

  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<BackupResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), PICK_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    setListError(null)
    const params: ListAdminUsersParams = {
      limit: PICK_LIMIT,
      sortField: 'email',
      sortDir: 'asc',
    }
    if (debouncedQ) params.q = debouncedQ
    listAdminUsers(params)
      .then((res) => {
        if (!cancelled) setResults(res.items)
      })
      .catch((err: Error) => {
        if (!cancelled) setListError(err.message ?? 'Failed to load users')
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQ])

  useEffect(() => {
    if (!selected) {
      setStatus(null)
      setStatusError(null)
      setStatusLoading(false)
      return
    }
    let cancelled = false
    setStatusLoading(true)
    setStatusError(null)
    getBackupStatus(selected.id)
      .then((res) => {
        if (!cancelled) setStatus(res)
      })
      .catch((err: Error) => {
        if (!cancelled) setStatusError(err.message ?? 'Failed to load backup status')
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, statusVersion])

  const runBackup = async () => {
    if (!selected) return
    setConfirming(false)
    setInFlight(true)
    setRunError(null)
    setResult(null)
    try {
      const res = await backupUser(selected.id)
      setResult(res)
      setStatusVersion((v) => v + 1)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setInFlight(false)
    }
  }

  const pick = (user: AdminUserRow) => {
    setSelected(user)
    setSearchInput('')
    setOpen(false)
  }

  return (
    <AdminSection
      title="User Backups"
      subtitle="Copy one user's rows and original files to S3."
      icon={<FaDatabase />}
      actions={
        <RefreshButton
          onClick={() => setStatusVersion((v) => v + 1)}
          label="Refresh backup status"
          disabled={!selected || inFlight}
        />
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-container rounded-lg p-4">
          <p className="text-label-xs uppercase font-mono text-outline mb-2">User</p>
          <div className="relative">
            <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-xs pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              placeholder="Search name or email…"
              aria-label="Search users for backup"
              disabled={inFlight}
              className="w-full bg-surface-container-low border border-border-dark focus:border-primary/50 focus:ring-1 focus:ring-primary outline-none rounded-lg pl-9 pr-3 py-2 text-xs text-on-surface placeholder-outline transition-colors disabled:opacity-50"
            />
            {open && (
              <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border-dark bg-surface-container-low shadow-lg divide-y divide-border-dark/60">
                {listError ? (
                  <li className="px-3 py-2 text-xs text-status-error">{listError}</li>
                ) : listLoading && results.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-outline">Searching…</li>
                ) : results.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-outline">No users match.</li>
                ) : (
                  results.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        // keep focus on the input so onBlur doesn't close the list before the click
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(u)}
                        disabled={inFlight}
                        className={cx(
                          'w-full text-left flex items-center gap-2.5 px-3 py-2 transition-colors disabled:opacity-50',
                          selected?.id === u.id
                            ? 'bg-primary/10'
                            : 'hover:bg-surface-container-high',
                        )}
                      >
                        <span className="w-6 h-6 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-[10px] font-bold flex items-center justify-center">
                          {u.displayName.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-mono text-xs text-on-surface truncate">
                            {u.email}
                          </span>
                          <span className="block text-[10px] text-outline truncate">
                            {u.displayName}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          {selected ? (
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-surface-container-low p-3">
              <span className="w-8 h-8 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-xs font-bold flex items-center justify-center">
                {selected.displayName.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-on-surface truncate">
                  {selected.displayName}
                </p>
                <p className="font-mono text-[10px] text-on-surface-variant truncate">
                  {selected.email}
                </p>
                <p className="font-mono text-[10px] text-outline truncate">{selected.id}</p>
              </div>
              <RoleBadge role={selected.role} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-outline">Pick a user to back up.</p>
          )}
        </div>

        <div className="bg-surface-container rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-label-xs uppercase font-mono text-outline mr-auto">
              Existing backup
            </p>
            {status && (
              <StatusPill tone={status.exists ? 'ok' : 'muted'}>
                {status.exists ? 'Backed up' : 'None'}
              </StatusPill>
            )}
          </div>
          {!selected ? (
            <p className="text-xs text-on-surface-variant">
              Select a user to check for an existing backup.
            </p>
          ) : statusLoading ? (
            <div className="h-24 rounded bg-surface-container-high/50 animate-pulse" />
          ) : statusError ? (
            <div className="py-2">
              <p className="text-xs text-status-error mb-2">{statusError}</p>
              <GhostButton onClick={() => setStatusVersion((v) => v + 1)}>Retry</GhostButton>
            </div>
          ) : status?.exists ? (
            <StatStrip
              rows={[
                { label: 'Backed up', value: stamp(status.backedUpAt) },
                { label: 'Files', value: (status.files ?? 0).toLocaleString() },
                { label: 'Assets', value: (status.assets ?? 0).toLocaleString() },
                { label: 'Email at backup', value: status.emailAtBackup ?? '—', tone: 'muted' },
              ]}
            />
          ) : status ? (
            <p className="text-xs text-on-surface-variant">No backup yet for this user.</p>
          ) : null}
          {result && (
            <p className="mt-3 font-mono text-[10px] text-on-surface-variant break-all">
              Last run {stamp(result.backedUpAt)} — {result.files.toLocaleString()} files,{' '}
              {result.assets.toLocaleString()} assets · {result.prefix}
            </p>
          )}
        </div>
      </div>

      {inFlight && (
        <div className="mt-4" role="status">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-on-surface">
            <FaSpinner className="animate-spin text-primary" />
            Backing up {selected?.email}…
          </div>
          <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
          </div>
        </div>
      )}

      <div className="border-t border-border-dark/40 pt-4 mt-4 flex items-start justify-between gap-4 flex-wrap">
        <p className="text-body-sm text-on-surface-variant max-w-lg">
          Runs inline in the API — multi-GB libraries can take a while. Reruns overwrite the same S3
          keys.
        </p>
        <PrimaryButton
          onClick={() => setConfirming(true)}
          disabled={!selected || inFlight}
          icon={inFlight ? <FaSpinner className="animate-spin" /> : undefined}
        >
          {inFlight ? 'Backing up…' : 'Run backup'}
        </PrimaryButton>
      </div>

      {result && (
        <AdminToast
          message={`Backed up ${result.files.toLocaleString()} files, ${result.assets.toLocaleString()} assets → ${result.prefix}`}
        />
      )}
      {runError && <AdminToast message={runError} tone="error" />}

      {confirming && selected && (
        <ConfirmDialog
          title={`Back up ${selected.email}?`}
          onClose={() => setConfirming(false)}
          onConfirm={() => void runBackup()}
        >
          <p className="text-sm text-slate-400 mt-2">
            Copies this user's rows and original files to S3 under the prefix below. The backup runs
            now, in the API process, so large libraries take a while.
          </p>
          <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 mt-2 break-all">
            {backupPrefixPreview(selected.email, selected.id)}
          </code>
        </ConfirmDialog>
      )}
    </AdminSection>
  )
}
