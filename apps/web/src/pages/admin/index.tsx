import { useEffect, useState } from 'react'
import {
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpDown,
  FaMagnifyingGlass,
  FaSpinner,
  FaUserShield,
} from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { RequireAdmin } from '../../components/RequireAdmin'
import { AppShell } from '../../components/AppShell'
import { listAdminUsers, type ListAdminUsersParams } from '../../api/admin'
import { formatBytes } from '../../lib/format'
import type { AdminUserListResponse, AdminUserSortField } from '@photox/shared-types'

type SortDir = 'asc' | 'desc'

interface SortState {
  field: AdminUserSortField
  dir: SortDir
}

const DEFAULT_SORT: SortState = { field: 'createdAt', dir: 'desc' }
const DEFAULT_LIMIT = 20

function AdminPageContent() {
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
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <FaUserShield className="text-2xl text-primary" />
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Users</h1>
          <span className="text-xs font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
            Admin only
          </span>
        </div>
        <div className="relative w-full sm:w-72">
          <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or email…"
            className="w-full bg-card-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors"
          />
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <FaSpinner className="text-2xl text-primary animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-6 text-center">
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button
            type="button"
            onClick={() => setVersion((v) => v + 1)}
            className="text-sm font-medium text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-12 text-center">
          <p className="text-slate-400">No users match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="bg-card-dark border border-border-dark rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/50 text-xs uppercase text-slate-400 tracking-wider">
                <tr>
                  <SortHeader field="displayName" label="Name" sort={sort} onSort={onSort} />
                  <SortHeader field="email" label="Email" sort={sort} onSort={onSort} />
                  <SortHeader field="role" label="Role" sort={sort} onSort={onSort} />
                  <th className="text-right font-semibold px-4 py-3">Assets</th>
                  <th className="text-right font-semibold px-4 py-3">Space</th>
                  <SortHeader field="createdAt" label="Created" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark">
                {items.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-slate-100">{u.displayName}</td>
                    <td className="px-4 py-3 text-slate-300">{u.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                      {u.assetCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                      {formatBytes(u.bytesUsed) ?? '0 B'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex items-center justify-between text-sm text-slate-400">
            <span>
              {total.toLocaleString()} {total === 1 ? 'user' : 'users'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - DEFAULT_LIMIT))}
                className="px-3 py-1.5 rounded-lg bg-card-dark border border-border-dark text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
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
                className="px-3 py-1.5 rounded-lg bg-card-dark border border-border-dark text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
              >
                Next
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  )
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
        className="inline-flex items-center gap-1.5 hover:text-slate-100 transition-colors"
      >
        {label}
        <Icon className={`text-[10px] ${active ? 'text-primary' : 'text-slate-500'}`} />
      </button>
    </th>
  )
}

function RoleBadge({ role }: { role: 'user' | 'admin' }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
        <FaUserShield className="text-[10px]" />
        admin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-xs font-medium text-slate-300 bg-slate-700/40 border border-slate-600/40 rounded-full px-2 py-0.5">
      user
    </span>
  )
}

export default function AdminPage() {
  return (
    <RequireAuth>
      <RequireAdmin>
        <AppShell>
          <AdminPageContent />
        </AppShell>
      </RequireAdmin>
    </RequireAuth>
  )
}
