import type { ComponentType } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  FaClock,
  FaPhotoFilm,
  FaHeart,
  FaUsers,
  FaFaceSmile,
  FaMapLocationDot,
  FaTrash,
  FaUserShield,
  FaRightFromBracket,
} from 'react-icons/fa6'
import { useAuthStore } from '../store/auth-store'

interface SidebarLinkProps {
  to: string
  icon: ComponentType<{ className?: string }>
  label: string
  end?: boolean
}

/** Shared nav row: the same active highlight (tint + left bar) for every sidebar section. */
function SidebarLink({ to, icon: Icon, label, end }: SidebarLinkProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center justify-center gap-4 h-[50px] lg:h-auto py-3 rounded-lg transition-colors group/item relative overflow-hidden lg:justify-start lg:px-3 ${
          isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-slate-900 dark:hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="shrink-0" />
          <span className="hidden lg:inline whitespace-nowrap">{label}</span>
          {isActive && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full" />
          )}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    void navigate('/login')
  }

  const navItems: SidebarLinkProps[] = [
    { to: '/', icon: FaClock, label: 'Timeline', end: true },
    { to: '/albums', icon: FaPhotoFilm, label: 'Albums' },
    { to: '/favorites', icon: FaHeart, label: 'Favorites' },
    { to: '/people', icon: FaFaceSmile, label: 'People' },
    { to: '/shared', icon: FaUsers, label: 'Shared' },
    { to: '/places', icon: FaMapLocationDot, label: 'Places' },
  ]

  const bottomNavItems: SidebarLinkProps[] = [
    { to: '/trash', icon: FaTrash, label: 'Trash' },
    ...(user?.role === 'admin' ? [{ to: '/admin', icon: FaUserShield, label: 'Admin' }] : []),
  ]

  return (
    <aside className="flex flex-col w-[50px] lg:w-60 bg-white dark:bg-background-dark border-r border-gray-200 dark:border-border-dark transition-[width] duration-300 group shrink-0">
      <nav className="flex flex-col gap-2 mt-4 lg:p-3">
        {navItems.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="mt-auto">
        <div className="pb-1 lg:p-3">
          {bottomNavItems.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        </div>

        <div className="border-t border-gray-200 dark:border-border-dark py-2 lg:p-3">
          <button
            type="button"
            onClick={() => {
              void handleLogout()
            }}
            title="Sign out"
            aria-label="Sign out"
            className="w-full flex items-center justify-center gap-4 h-[50px] lg:h-auto lg:py-3 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-card-dark hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer lg:justify-start lg:px-3"
          >
            <FaRightFromBracket className="shrink-0" />
            <span className="hidden lg:inline whitespace-nowrap">Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
