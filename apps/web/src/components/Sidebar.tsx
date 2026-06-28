import { NavLink } from 'react-router-dom'
import {
  FaClock,
  FaPhotoFilm,
  FaHeart,
  FaUsers,
  FaMapLocationDot,
  FaTrash,
  FaGear,
  FaUserShield,
} from 'react-icons/fa6'
import { useAuthStore } from '../store/auth-store'

export function Sidebar() {
  const user = useAuthStore((s) => s.user)

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
    ...(user?.role === 'admin' ? [{ to: '/admin', icon: FaUserShield, label: 'Admin' }] : []),
  ]

  return (
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
  )
}
