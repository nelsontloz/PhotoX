import { type ReactNode } from 'react'
import { FaUser, FaUserShield } from 'react-icons/fa6'
import { ConfirmShell } from '../../components/ConfirmProvider'
import { Button } from './ui'

// --- cross-tab pieces -------------------------------------------------------------------
// Bits used by more than one admin tab (confirm dialogs, retry line, role pill). Chrome that
// serves a single tab (matrix panels, model headers, queue polling) lives next to that tab.

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
 * Shared confirm shell for the admin page's five one-way dialogs: the app's confirm panel and
 * Cancel/Confirm footer, with overlay/Escape close off. Call sites render it inside their own
 * `{state && ...}` guard and pass the body as children.
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
    <ConfirmShell
      title={title}
      confirmLabel={confirmLabel}
      onCancel={onClose}
      onConfirm={onConfirm}
      escapeKey={false}
    >
      {children}
    </ConfirmShell>
  )
}

/** Shape check shared by the account dialogs; the core validates for real. */
export function emailLooksValid(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
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
