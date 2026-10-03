import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FaCamera, FaMagnifyingGlass } from 'react-icons/fa6'
import { useAuthStore } from '../store/auth-store'
import { UploadButton } from './UploadButton'
import { SearchInput } from './SearchBar'

export function AppHeader() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  // Leaving the search page exits mobile search mode; the debounced navigation TO /search must not.
  useEffect(() => {
    if (location.pathname !== '/search') setMobileSearchOpen(false)
  }, [location.pathname])

  const initials =
    user?.displayName
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? 'U'

  const handleLogout = async () => {
    await logout()
    void navigate('/login')
  }

  return (
    <header className="relative flex items-center justify-between border-b border-gray-200 dark:border-border-dark bg-white/95 dark:bg-background-dark/95 px-6 py-3 z-40 shrink-0 h-16 w-full">
      <div className="flex items-center gap-3 shrink-0 md:w-1/4">
        <div className="flex items-center gap-3">
          <div className="size-8 bg-primary rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <FaCamera className="text-[16px]" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            PhotoX
          </h1>
        </div>
      </div>

      <div className="hidden md:flex flex-1 min-w-0 justify-center px-6">
        <SearchInput className="w-full max-w-md" />
      </div>

      <div className="flex items-center justify-end gap-4 shrink-0 md:w-1/4 ml-auto">
        <button
          type="button"
          onClick={() => setMobileSearchOpen(true)}
          aria-label="Search"
          className="md:hidden size-9 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-card-dark transition-colors"
        >
          <FaMagnifyingGlass className="text-[15px]" />
        </button>
        <UploadButton variant="compact" />
        <div className="h-6 w-px bg-gray-200 dark:border-border-dark mx-1 hidden sm:block" />
        <button
          onClick={() => {
            void handleLogout()
          }}
          title="Sign out"
          className="size-9 rounded-full bg-gradient-to-br from-primary to-purple-600 p-[2px] ring-2 ring-transparent hover:ring-primary/50 transition-all cursor-pointer"
        >
          <div className="w-full h-full rounded-full bg-slate-800 flex items-center justify-center overflow-hidden text-xs font-bold text-white">
            {user?.avatarUrl ? (
              <img alt="User Avatar" className="w-full h-full object-cover" src={user.avatarUrl} />
            ) : (
              initials
            )}
          </div>
        </button>
      </div>

      {mobileSearchOpen && (
        <div className="absolute inset-0 z-50 flex items-center gap-3 bg-white dark:bg-background-dark px-4 md:hidden">
          <SearchInput autoFocus className="flex-1" onEscape={() => setMobileSearchOpen(false)} />
          <button
            type="button"
            onClick={() => setMobileSearchOpen(false)}
            className="text-sm font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
    </header>
  )
}
