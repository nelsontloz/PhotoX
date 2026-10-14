import { useEffect, useState } from 'react'
import {
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpDown,
  FaCircleExclamation,
  FaDatabase,
  FaMagnifyingGlass,
  FaSpinner,
  FaTrashCan,
  FaTriangleExclamation,
  FaUserShield,
} from 'react-icons/fa6'
import { isAxiosError } from 'axios'
import {
  type AdminUserListResponse,
  type AdminUserRow,
  type AdminUserSortField,
} from '@photox/shared-types'
import { LoadingState } from '../../components/StateViews'
import { Dialog, formInputClass } from '../../components/Dialog'
import { useAuthStore } from '../../store/auth-store'
import { AdminCard, AdminSection, AdminToast, GhostButton, StatusPill, cx } from './ui'
import {
  deleteAdminUser,
  getAdminUserDeletePreview,
  listAdminUsers,
  pollAdminUserDelete,
  type AdminUserDeletePreview,
  type ListAdminUsersParams,
} from '../../api/admin'
import { RoleBadge } from './shared'

// --- users ------------------------------------------------------------------------------

type SortDir = 'asc' | 'desc'

interface SortState {
  field: AdminUserSortField
  dir: SortDir
}

const DEFAULT_SORT: SortState = { field: 'createdAt', dir: 'desc' }
const DEFAULT_LIMIT = 20

const SELF_DELETE_GUARD = "You can't delete your own account."
const LAST_ADMIN_GUARD = "The last admin can't be deleted."
const GENERIC_COUNTS = 'Their photos, videos, albums and shares will be permanently removed.'

/** Never leak axios verbatim; the server guards map to plain sentences. */
function deleteErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { message?: unknown } | undefined
    const serverMessage = typeof data?.message === 'string' ? data.message : null
    if (err.response?.status === 403) return serverMessage ?? SELF_DELETE_GUARD
    if (err.response?.status === 409) return serverMessage ?? LAST_ADMIN_GUARD
    if (err.response?.status === 404) {
      return 'That user no longer exists. Close this and refresh the list.'
    }
    if (serverMessage) return serverMessage
  }
  return err instanceof Error ? err.message : 'Delete failed. Try again.'
}

function countsLine(preview: AdminUserDeletePreview | null): string {
  if (preview == null) return GENERIC_COUNTS
  const parts: string[] = []
  if (typeof preview.assets === 'number') parts.push(`${preview.assets.toLocaleString()} assets`)
  if (typeof preview.files === 'number') parts.push(`${preview.files.toLocaleString()} files`)
  if (typeof preview.albums === 'number') parts.push(`${preview.albums.toLocaleString()} albums`)
  if (typeof preview.shares === 'number') parts.push(`${preview.shares.toLocaleString()} shares`)
  if (parts.length === 0) return GENERIC_COUNTS
  return `${parts.join(' · ')} will be permanently removed.`
}

interface SortHeaderProps {
  field: AdminUserSortField
  label: string
  sort: SortState
  onSort: (field: AdminUserSortField) => void
}

function SortHeader({ field, label, sort, onSort }: SortHeaderProps) {
  const active = sort.field === field
  const Icon = !active ? FaArrowsUpDown : sort.dir === 'asc' ? FaArrowUp : FaArrowDown
  return (
    <th className="text-left font-semibold px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1.5 hover:text-on-surface transition-colors"
      >
        {label}
        <Icon className={cx('text-[10px]', active ? 'text-primary' : 'text-outline')} />
      </button>
    </th>
  )
}

// --- delete dialog ----------------------------------------------------------------------
// Owns its layout: identity card up top, impact counts, the S3-kept note, then the typed
// gate and footer. Stays open on failure (error box inline); closes only on success.

function DeleteUserDialog({
  user,
  onClose,
  onDeleted,
}: {
  user: AdminUserRow
  onClose: () => void
  onDeleted: (displayName: string) => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [preview, setPreview] = useState<AdminUserDeletePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPreviewLoading(true)
    getAdminUserDeletePreview(user.id)
      .then((res) => {
        if (!cancelled) setPreview(res)
      })
      .catch(() => {
        // Preview is best-effort (older cores 404) — the DELETE still reports the truth.
        if (!cancelled) setPreview(null)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user.id])

  const confirmed = confirmText === 'DELETE'
  const close = () => {
    if (!working) onClose()
  }

  const onConfirm = async () => {
    if (!confirmed || working) return
    setWorking(true)
    setError(null)
    try {
      const res = await deleteAdminUser(user.id)
      if (res.jobId) await pollAdminUserDelete(user.id)
      onDeleted(user.displayName)
    } catch (err: unknown) {
      setError(deleteErrorMessage(err))
      setWorking(false)
    }
  }

  return (
    <Dialog
      title={`Delete ${user.displayName}?`}
      onClose={close}
      ariaLabel="Delete user confirmation"
      closeOnOverlay={false}
      escapeKey={!working}
      closeDisabled={working}
      panelClassName="bg-card-dark border border-border-dark rounded-xl p-6 max-w-lg w-full"
      titleClassName="text-base font-semibold text-slate-100"
      icon={
        <span className="w-9 h-9 shrink-0 rounded-lg bg-status-error/10 flex items-center justify-center">
          <FaTriangleExclamation className="text-status-error text-base" />
        </span>
      }
    >
      <div className="mt-4 space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-surface-container px-3 py-2.5">
          <span className="w-8 h-8 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-xs font-bold flex items-center justify-center">
            {user.displayName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-on-surface truncate">{user.displayName}</p>
            <p className="font-mono text-[11px] text-outline truncate">{user.email}</p>
          </div>
          <RoleBadge role={user.role} />
        </div>

        {previewLoading ? (
          <div
            aria-label="Loading account details"
            className="h-4 rounded bg-surface-container-high animate-pulse"
          />
        ) : (
          <p className="text-sm text-slate-300">{countsLine(preview)}</p>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-surface-container px-3 py-2.5 text-xs text-on-surface-variant">
          <FaDatabase className="mt-0.5 shrink-0 text-outline" aria-hidden="true" />
          <span>S3 backup is kept — only the live account and its library are removed.</span>
        </p>

        <div>
          <label
            htmlFor="delete-user-confirm"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Type <span className="font-mono font-bold">DELETE</span> to confirm
          </label>
          <input
            id="delete-user-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            autoFocus
            disabled={working}
            className={cx(formInputClass, 'font-mono tracking-widest')}
          />
        </div>

        {working && (
          <p role="status" className="flex items-center gap-2 text-xs text-on-surface-variant">
            <FaSpinner className="animate-spin" aria-hidden="true" />
            Removing user… this can take a moment.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-status-error/10 px-3 py-2.5 text-xs text-status-error"
          >
            <FaCircleExclamation className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button
          type="button"
          onClick={close}
          disabled={working}
          className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={!confirmed || working}
          className="inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-status-error/90 hover:bg-status-error rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {working && <FaSpinner className="animate-spin" aria-hidden="true" />}
          {working ? 'Deleting…' : 'Delete user'}
        </button>
      </div>
    </Dialog>
  )
}

export function UsersSection() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [offset, setOffset] = useState(0)
  const [version, setVersion] = useState(0)
  const [data, setData] = useState<AdminUserListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminUserRow | null>(null)
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const currentUserId = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setOffset(0)
  }, [debouncedQ, sort])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: ListAdminUsersParams = {
      limit: DEFAULT_LIMIT,
      offset,
      sortField: sort.field,
      sortDir: sort.dir,
    }
    if (debouncedQ) params.q = debouncedQ
    listAdminUsers(params)
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load users')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQ, sort, offset, version])

  const total = data?.total ?? 0
  const currentPage = Math.floor(offset / DEFAULT_LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_LIMIT))
  const items = data?.items ?? []
  const adminCount = items.filter((u) => u.role === 'admin').length
  // The last-admin guard only applies when the whole directory fits on this page;
  // anything paged out stays the server's call (409 surfaces in the dialog).
  const fullyLoaded = items.length > 0 && total <= items.length

  const guardFor = (u: AdminUserRow): string | null => {
    if (currentUserId != null && u.id === currentUserId) return SELF_DELETE_GUARD
    if (u.role === 'admin' && adminCount === 1 && fullyLoaded) return LAST_ADMIN_GUARD
    return null
  }

  const onSort = (field: AdminUserSortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { field, dir: field === 'createdAt' || field === 'email' ? 'desc' : 'asc' }
    })
  }

  return (
    <AdminSection
      card={false}
      title="Users Management"
      subtitle="Manage roles for accounts on this instance"
      icon={
        <span className="w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center">
          <FaUserShield className="text-primary text-sm" />
        </span>
      }
      actions={
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill tone="warn">Admin only</StatusPill>
          <div className="relative w-full sm:w-72">
            <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-xs" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or email…"
              aria-label="Search users"
              className="w-full bg-surface-container border border-border-dark focus:border-primary/50 focus:ring-1 focus:ring-primary outline-none rounded-lg pl-9 pr-3 py-2 text-xs text-on-surface placeholder-outline transition-colors"
            />
          </div>
        </div>
      }
    >
      {loading ? (
        <LoadingState className="flex items-center justify-center py-24" />
      ) : error ? (
        <AdminCard className="text-center">
          <p className="text-sm text-status-error mb-3">{error}</p>
          <GhostButton onClick={() => setVersion((v) => v + 1)}>Retry</GhostButton>
        </AdminCard>
      ) : items.length === 0 ? (
        <AdminCard className="p-12 text-center">
          <p className="text-on-surface-variant">No users match the current filters.</p>
        </AdminCard>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface-container-low">
          <table className="w-full text-xs">
            <thead className="bg-surface-container text-on-surface-variant font-mono text-label-xs uppercase tracking-wider">
              <tr>
                <SortHeader field="displayName" label="User" sort={sort} onSort={onSort} />
                <SortHeader field="email" label="Email" sort={sort} onSort={onSort} />
                <SortHeader field="role" label="Role" sort={sort} onSort={onSort} />
                <SortHeader field="createdAt" label="Created" sort={sort} onSort={onSort} />
                <th className="text-right font-semibold px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark">
              {items.map((u) => {
                const guard = guardFor(u)
                return (
                  <tr key={u.id} className="hover:bg-surface-container/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-[11px] font-bold flex items-center justify-center">
                          {u.displayName.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="text-on-surface font-medium truncate">{u.displayName}</p>
                          <p className="font-mono text-[10px] text-outline truncate">{u.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-on-surface-variant">{u.email}</td>
                    <td className="py-3.5 px-4">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="py-3.5 px-4 font-mono text-outline">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setTarget(u)}
                          disabled={guard != null}
                          title={guard ?? `Delete ${u.displayName}`}
                          aria-label={`Delete ${u.displayName}`}
                          className={cx(
                            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                            guard != null
                              ? 'text-outline/60 cursor-not-allowed'
                              : 'text-status-error/80 hover:text-status-error hover:bg-status-error/10',
                          )}
                        >
                          <FaTrashCan className="text-xs" aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <footer className="bg-surface-container px-4 py-3 flex items-center justify-between text-xs text-outline font-mono">
            <span>Showing {total.toLocaleString()} registered user(s)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - DEFAULT_LIMIT))}
                className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-dark text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
              >
                Prev
              </button>
              <span className="px-2 tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + DEFAULT_LIMIT)}
                className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-dark text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      )}

      {notice && <AdminToast key={notice.id} message={notice.text} />}

      {target && (
        <DeleteUserDialog
          user={target}
          onClose={() => setTarget(null)}
          onDeleted={(displayName) => {
            setTarget(null)
            setNotice({ id: Date.now(), text: `Deleted ${displayName}.` })
            setVersion((v) => v + 1)
          }}
        />
      )}
    </AdminSection>
  )
}
