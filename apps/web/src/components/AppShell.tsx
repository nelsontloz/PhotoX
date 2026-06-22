import { useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  FaCamera,
  FaClock,
  FaPhotoFilm,
  FaHeart,
  FaUsers,
  FaMapLocationDot,
  FaTrash,
  FaGear,
  FaMagnifyingGlass,
  FaSliders,
  FaBell,
} from 'react-icons/fa6'
import { useAuthStore } from '../store/auth-store'
import { UploadButton, type UploadButtonHandle } from './UploadButton'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const uploadRef = useRef<UploadButtonHandle>(null)

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

  const navItems = [
    { to: '/', icon: FaClock, label: 'Timeline', end: true },
    { to: '/albums', icon: FaPhotoFilm, label: 'Albums' },
    { to: '/favorites', icon: FaHeart, label: 'Favorites' },
    { to: '/shared', icon: FaUsers, label: 'Shared' },
    { to: '/places', icon: FaMapLocationDot, label: 'Places' },
  ]

  const bottomNavItems = [
    { to: '/trash', icon: FaTrash, label: 'Trash' },
    { to: '/settings', icon: FaGear, label: 'Settings' },
  ]

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-border-dark bg-white/80 dark:bg-background-dark/80 backdrop-blur-md px-6 py-3 z-40 shrink-0 h-16 w-full">
        <div className="flex items-center gap-6 w-1/4">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-primary rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary/20">
              <FaCamera className="text-[16px]" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              PhotoX
            </h1>
          </div>
        </div>

        <div className="flex-1 max-w-lg mx-auto">
          <div className="relative flex items-center w-full group">
            <div className="absolute left-3 text-slate-400 group-focus-within:text-primary transition-colors">
              <FaMagnifyingGlass className="text-[14px]" />
            </div>
            <input
              className="w-full bg-slate-100 dark:bg-card-dark border-transparent focus:border-primary/50 focus:ring-0 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-500 transition-all shadow-sm"
              placeholder="Search memories, places, or dates..."
              type="text"
            />
            <div className="absolute right-2 flex gap-1">
              <button
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-400 transition-colors"
                title="Filter options"
              >
                <FaSliders className="text-[14px]" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-4 w-1/4">
          <UploadButton ref={uploadRef} variant="compact" />
          <div className="h-6 w-px bg-gray-200 dark:border-border-dark mx-1 hidden sm:block" />
          <button className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-card-dark text-slate-500 dark:text-slate-400 transition-colors">
            <FaBell className="text-[18px]" />
            <span className="absolute top-2 right-2 size-2 bg-red-500 rounded-full border-2 border-white dark:border-background-dark" />
          </button>
          <button
            onClick={() => {
              void handleLogout()
            }}
            title="Sign out"
            className="size-9 rounded-full bg-gradient-to-br from-primary to-purple-600 p-[2px] ring-2 ring-transparent hover:ring-primary/50 transition-all cursor-pointer"
          >
            <div className="w-full h-full rounded-full bg-slate-800 flex items-center justify-center overflow-hidden text-xs font-bold text-white">
              {user?.avatarUrl ? (
                <img
                  alt="User Avatar"
                  className="w-full h-full object-cover"
                  src={user.avatarUrl}
                />
              ) : (
                initials
              )}
            </div>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex flex-col w-[72px] lg:w-60 bg-white dark:bg-background-dark border-r border-gray-200 dark:border-border-dark transition-[width] duration-300 group shrink-0">
          <nav className="flex flex-col gap-2 p-3 mt-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-4 px-3 py-3 rounded-lg transition-colors group/item relative overflow-hidden ${
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-slate-900 dark:hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className="shrink-0" />
                    <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 lg:opacity-100 transition-opacity duration-300">
                      {item.label}
                    </span>
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto p-3 mb-4">
            {bottomNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className="flex items-center gap-4 px-3 py-3 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-slate-900 dark:hover:text-white transition-colors group/item"
              >
                <item.icon className="shrink-0" />
                <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 lg:opacity-100 transition-opacity duration-300">
                  {item.label}
                </span>
              </NavLink>
            ))}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto relative scroll-smooth px-4 sm:px-8 pb-6 pt-6">
          {children}
        </main>
      </div>
    </div>
  )
}
