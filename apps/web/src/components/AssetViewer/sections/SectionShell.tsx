import type { ReactNode } from 'react'

/**
 * Shared viewer info-section shell: icon header + body. Empty states render `compact` (mb-2),
 * populated ones the roomier mb-3; icon-less sections (Location) render the bare h4.
 * Trailing `action` slots the Faces count badge.
 */
export function SectionShell({
  icon,
  title,
  action,
  compact = false,
  children,
}: {
  icon?: ReactNode
  title: string
  action?: ReactNode
  compact?: boolean
  children: ReactNode
}) {
  const spacing = compact ? 'mb-2' : 'mb-3'
  return (
    <section>
      {icon ? (
        <div className={`flex items-center gap-2 text-slate-400 ${spacing}`}>
          {icon}
          <h4 className="text-xs font-bold uppercase tracking-wider">{title}</h4>
          {action}
        </div>
      ) : (
        <h4 className={`text-xs font-bold uppercase tracking-wider text-slate-400 ${spacing}`}>
          {title}
        </h4>
      )}
      {children}
    </section>
  )
}
