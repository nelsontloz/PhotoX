import { useEffect, type ReactNode } from 'react'
import { FaXmark } from 'react-icons/fa6'

/** The shared dark text field style used by the album dialogs. */
export const formInputClass =
  'w-full bg-background-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors'

interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Full class list for the panel (defaults reproduce the plain dialog). */
  panelClassName?: string
  titleClassName?: string
  titleTag?: 'h2' | 'h3'
  /** Optional leading icon: wraps the title in the album-picker's icon row. */
  icon?: ReactNode
  /** Empty string renders the bare title (admin confirm dialogs have no header row). */
  headerClassName?: string
  closeClassName?: string
  closeDisabled?: boolean
  /** Overlay click / Escape close — off for dialogs that must be answered. */
  closeOnOverlay?: boolean
  escapeKey?: boolean
  /** Enables role="dialog" + aria-modal + aria-label; omitted where the old markup had none. */
  ariaLabel?: string
}

export function Dialog({
  title,
  onClose,
  children,
  panelClassName = 'bg-card-dark rounded-xl shadow-2xl p-6 w-full',
  titleClassName = 'text-lg font-bold text-white',
  titleTag: Title = 'h2',
  icon,
  headerClassName = 'flex items-center justify-between mb-4',
  closeClassName = 'text-slate-400 hover:text-white transition-colors p-1 shrink-0',
  closeDisabled,
  closeOnOverlay = true,
  escapeKey = true,
  ariaLabel,
}: DialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Modal: keep window-level shortcuts (viewer arrows/Escape) inert while open.
      e.stopPropagation()
      if (escapeKey && e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [escapeKey, onClose])

  const heading = icon ? (
    <div className="flex items-center gap-2 min-w-0">
      {icon}
      <Title className={titleClassName}>{title}</Title>
    </div>
  ) : (
    <Title className={titleClassName}>{title}</Title>
  )

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={closeOnOverlay ? onClose : undefined}
      {...(ariaLabel ? { role: 'dialog', 'aria-modal': true, 'aria-label': ariaLabel } : {})}
    >
      <div className={panelClassName} onClick={(e) => e.stopPropagation()}>
        {headerClassName ? (
          <div className={headerClassName}>
            {heading}
            <button
              type="button"
              onClick={onClose}
              disabled={closeDisabled}
              className={closeClassName}
              aria-label="Close"
            >
              <FaXmark className="text-lg" />
            </button>
          </div>
        ) : (
          heading
        )}
        {children}
      </div>
    </div>
  )
}
