import { type ReactNode } from 'react'
import { FaUser, FaUserShield } from 'react-icons/fa6'
import { Dialog } from '../../components/Dialog'
import { Button } from './ui'

// --- cross-tab pieces -------------------------------------------------------------------
// Bits used by more than one admin tab (confirm dialogs, retry line, role pill). Chrome that
// serves a single tab (matrix panels, model headers, queue polling) lives next to that tab.

const DIALOG_PANEL_CLASS = 'bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full'
const DIALOG_TITLE_CLASS = 'text-base font-semibold text-slate-100'

export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-2 text-center">
      <p className="text-xs text-status-error mb-2">{message}</p>
      <Button variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

/**
 * Shared confirm shell for the admin page's five one-way dialogs: same panel, same Cancel/Confirm
 * footer. Call sites render it inside their own `{state && ...}` guard and pass the body as children.
 */
export function ConfirmDialog({
  title,
  confirmLabel = 'Confirm',
  onConfirm,
  onClose,
  children,
}: {
  title: string
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      panelClassName={DIALOG_PANEL_CLASS}
      titleTag="h3"
      titleClassName={DIALOG_TITLE_CLASS}
      headerClassName=""
      closeOnOverlay={false}
      escapeKey={false}
    >
      {children}
      <div className="flex justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

export function RoleBadge({ role }: { role: 'user' | 'admin' }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 bg-amber-500/10 rounded-full px-2 py-0.5">
        <FaUserShield className="text-[10px]" />
        admin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-on-surface-variant bg-surface-container-highest rounded-full px-2 py-0.5">
      <FaUser className="text-[10px]" />
      user
    </span>
  )
}
