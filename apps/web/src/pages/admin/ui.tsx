import { useEffect, useState, type ReactNode } from 'react'
import { FaCircleCheck, FaCircleExclamation } from 'react-icons/fa6'

/**
 * Shared admin-console primitives. Every admin section used to copy-paste the same header/card
 * class strings; these centralize the Material-dark surface scale declared in app.css `@theme`.
 */

/** Join conditional class fragments (the repo deliberately has no clsx dependency). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ')
}

/** Clamp an optional 0–100 value; missing or NaN renders as 0. */
function clampPercent(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function AdminSection({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
}: {
  title: string
  subtitle?: string
  icon: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-lg text-outline">{icon}</span>
          <div>
            <h2 className="text-headline-lg text-on-surface">{title}</h2>
            {subtitle && <p className="text-body-sm text-outline">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function AdminCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'bg-surface-container-low border border-border-dark rounded-xl p-6 shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function MetricTile({
  label,
  value,
  unit,
  icon,
  meta,
  barPercent,
  bar,
}: {
  label: string
  value: ReactNode
  unit?: string
  icon: ReactNode
  meta?: ReactNode
  barPercent?: number
  /** Advanced slot: renders instead of the default percent track (e.g. a stacked allocation bar). */
  bar?: ReactNode
}) {
  const percent = clampPercent(barPercent)
  const track =
    barPercent != null ? (
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${label} progress`}
        className="mt-4 h-1 w-full rounded-full bg-surface-container-highest overflow-hidden"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    ) : null

  return (
    <AdminCard>
      <div className="flex items-center gap-2">
        <span className="text-[18px] text-outline">{icon}</span>
        <span className="text-label-sm uppercase tracking-wider text-outline">{label}</span>
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="text-[36px] font-bold leading-none text-on-surface">
          {value}
          {unit && (
            <span className="ml-1.5 text-lg font-normal text-on-surface-variant">{unit}</span>
          )}
        </p>
        {meta != null && (
          <span className="text-right font-mono text-xs text-on-surface-variant">{meta}</span>
        )}
      </div>
      {bar ?? track}
    </AdminCard>
  )
}

export function SectionCard({
  title,
  subtitle,
  icon,
  badge,
  children,
  className,
}: {
  title: string
  subtitle?: string
  icon: ReactNode
  badge?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <AdminCard className={className}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-lg text-outline">{icon}</span>
          <div>
            <h3 className="text-headline-lg text-on-surface">{title}</h3>
            {subtitle && <p className="text-body-sm text-outline">{subtitle}</p>}
          </div>
        </div>
        {badge != null && (
          <span className="rounded-full bg-surface-container-highest px-2.5 py-1 font-mono text-[11px] text-on-surface-variant">
            {badge}
          </span>
        )}
      </div>
      {children}
    </AdminCard>
  )
}

const BUTTON_BASE =
  'inline-flex items-center gap-2 text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

interface ButtonProps {
  type?: 'button' | 'submit' | 'reset'
  onClick?: () => void
  disabled?: boolean
  icon?: ReactNode
  children: ReactNode
  className?: string
}

export function PrimaryButton({
  type = 'button',
  onClick,
  disabled,
  icon,
  children,
  className,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        BUTTON_BASE,
        'bg-primary-container text-on-primary-container hover:bg-primary-container/90 shadow-sm',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function GhostButton({
  type = 'button',
  onClick,
  disabled,
  icon,
  children,
  className,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        BUTTON_BASE,
        'bg-surface-container text-on-surface hover:bg-surface-container-high',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function StatStrip({
  rows,
  note,
}: {
  rows: { label: string; value: ReactNode; tone?: 'default' | 'muted' }[]
  note?: ReactNode
}) {
  return (
    <div className="rounded-lg bg-surface-container p-3 font-mono text-xs flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3">
          <span className="text-on-surface">{row.label}</span>
          <span className={row.tone === 'muted' ? 'text-outline' : 'text-on-surface'}>
            {row.value}
          </span>
        </div>
      ))}
      {note != null && <p className="text-[11px] text-outline">{note}</p>}
    </div>
  )
}

const PILL_TONES: Record<'ok' | 'warn' | 'error' | 'muted', string> = {
  ok: 'bg-emerald-500/10 text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-300',
  error: 'bg-status-error/10 text-status-error',
  muted: 'bg-surface-container-highest text-on-surface-variant',
}

export function StatusPill({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'error' | 'muted'
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded px-2 py-0.5 font-mono text-label-xs font-bold uppercase',
        PILL_TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function ProgressBar({
  value,
  max,
  label,
  tone = 'default',
}: {
  value: number
  max: number
  label: string
  tone?: 'default' | 'warn' | 'ok'
}) {
  const percent = max > 0 && value > 0 ? Math.min(100, (value / max) * 100) : 0
  const fill = tone === 'warn' ? 'bg-tertiary' : tone === 'ok' ? 'bg-emerald-400' : 'bg-primary'
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="h-2 rounded-full bg-surface-container-high overflow-hidden"
    >
      <div
        className={cx('h-full transition-all duration-500', fill)}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

export function AdminToast({
  message,
  tone = 'default',
}: {
  message: ReactNode
  tone?: 'default' | 'error'
}) {
  const [fading, setFading] = useState(false)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const fade = setTimeout(() => setFading(true), 2900)
    const close = setTimeout(() => setOpen(false), 3200)
    return () => {
      clearTimeout(fade)
      clearTimeout(close)
    }
  }, [message])

  if (!open) return null
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50">
      <div
        className={cx(
          'flex items-center gap-2 rounded-lg border-l-4 bg-surface-container-highest px-4 py-2.5 font-mono text-xs text-on-surface shadow-xl transition-opacity duration-300',
          tone === 'error' ? 'border-status-error' : 'border-primary',
          fading ? 'opacity-0' : 'opacity-100',
        )}
      >
        {tone === 'error' ? (
          <FaCircleExclamation className="text-[18px] text-status-error" />
        ) : (
          <FaCircleCheck className="text-[18px] text-primary" />
        )}
        <span>{message}</span>
      </div>
    </div>
  )
}
