import { useEffect, useState } from 'react'
import {
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpDown,
  FaMagnifyingGlass,
  FaUserShield,
} from 'react-icons/fa6'
import { type AdminUserListResponse, type AdminUserSortField } from '@photox/shared-types'
import { LoadingState } from '../../components/StateViews'
import { AdminCard, AdminSection, GhostButton, StatusPill, cx } from './ui'
import { listAdminUsers, type ListAdminUsersParams } from '../../api/admin'
import { RoleBadge } from './shared'

// --- users ------------------------------------------------------------------------------

type SortDir = 'asc' | 'desc'

interface SortState {
  field: AdminUserSortField
  dir: SortDir
}

const DEFAULT_SORT: SortState = { field: 'createdAt', dir: 'desc' }
const DEFAULT_LIMIT = 20

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

export function UsersSection() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [offset, setOffset] = useState(0)
  const [version, setVersion] = useState(0)
  const [data, setData] = useState<AdminUserListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark">
              {items.map((u) => (
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
                </tr>
              ))}
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
    </AdminSection>
  )
}
