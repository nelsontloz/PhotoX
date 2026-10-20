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

/**
 * Section header + body. Carded by default; `card={false}` renders a bare <section> for
 * top-level groups whose children card themselves. `headingTag` keeps h2/h3 nesting right.
 */
export function AdminSection({
  title,
  subtitle,
  icon,
  badge,
  actions,
  children,
  className,
  card = true,
  headingTag: Heading = 'h2',
}: {
  title: string
  subtitle?: string
  icon: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  card?: boolean
  headingTag?: 'h2' | 'h3'
}) {
  const body = (
    <>
      <div
        className={cx(
          'flex flex-wrap items-start justify-between',
          card ? 'mb-4 gap-3' : 'mb-3 gap-4',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-lg text-outline">{icon}</span>
          <div>
            <Heading className="text-headline-lg text-on-surface">{title}</Heading>
            {subtitle && <p className="text-body-sm text-outline">{subtitle}</p>}
          </div>
        </div>
        {badge != null && (
          <span className="rounded-full bg-surface-container-highest px-2.5 py-1 font-mono text-[11px] text-on-surface-variant">
            {badge}
          </span>
        )}
        {actions != null && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </>
  )
  return card ? (
    <AdminCard className={className}>{body}</AdminCard>
  ) : (
    <section className={className}>{body}</section>
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

/** Grid-column class for a tile count: 2 → 2, 3 → 3, anything else → 4. */
export function colsFor(n: number): string {
  return n === 2 ? 'grid-cols-2' : n === 3 ? 'grid-cols-3' : 'grid-cols-4'
}

/**
 * Single count tile (failures matrix + orphan grid). Bare inside a panel card by default;
 * `boxed` adds the card surface for standalone grids.
 */
export function CountTile({
  count,
  label,
  boxed = false,
}: {
  count: number
  label: string
  boxed?: boolean
}) {
  return (
    <div className={boxed ? 'bg-surface-container rounded-lg p-4 text-center' : 'text-center'}>
      <span
        className={cx(
          'text-2xl font-bold tabular-nums',
          count > 0 ? 'text-status-error' : 'text-on-surface-variant',
        )}
      >
        {count.toLocaleString()}
      </span>
      <p className="text-label-xs uppercase font-mono text-outline mt-1">{label}</p>
    </div>
  )
}

export function MetricTile({
  label,
  value,
  icon,
  meta,
  barPercent,
  bar,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  meta?: ReactNode
  barPercent?: number
  /** Advanced slot: renders instead of the default percent track (e.g. a stacked allocation bar). */
  bar?: ReactNode
}) {
  const percent =
    barPercent == null || !Number.isFinite(barPercent) ? 0 : Math.min(100, Math.max(0, barPercent))
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
        <p className="text-[36px] font-bold leading-none text-on-surface">{value}</p>
        {meta != null && (
          <span className="text-right font-mono text-xs text-on-surface-variant">{meta}</span>
        )}
      </div>
      {bar ?? track}
    </AdminCard>
  )
}

const BUTTON_BASE =
  'inline-flex items-center gap-2 text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low'

const OUTLINE_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold transition-colors'

const FOCUS_PRIMARY =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low'
const FOCUS_DANGER =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-error focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low'

const ICON_BUTTON_CLASS =
  'p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low'

type ButtonVariant =
  | 'primary'
  | 'ghost'
  | 'secondary'
  | 'danger'
  | 'dangerFlat'
  | 'outlinePrimary'
  | 'icon'

interface ButtonProps {
  /** Visual treatment. Primary/ghost are the filled compact buttons; the outline variants back tables. */
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  /** Outline variants only: `accent` tints the border primary for the one safe/main action in a row. */
  tone?: 'neutral' | 'accent'
  onClick?: () => void
  disabled?: boolean
  icon?: ReactNode
  title?: string
  ariaLabel?: string
  /** Icon variant only: replaces the default icon-button classes entirely. */
  className?: string
  children?: ReactNode
}

/**
 * The admin console's one button. Every variant reproduces the exact class string its
 * predecessor used, so consolidating them is a structural change only.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  tone = 'neutral',
  onClick,
  disabled,
  icon,
  title,
  ariaLabel,
  className,
  children,
}: ButtonProps) {
  const sizeClass =
    size === 'sm'
      ? 'px-2.5 py-1.5 text-[11px]'
      : size === 'lg'
        ? 'px-3 py-2 text-sm'
        : 'px-3 py-1.5 text-xs'
  let classes: string
  switch (variant) {
    case 'ghost':
      classes = cx(
        BUTTON_BASE,
        'bg-surface-container text-on-surface hover:bg-surface-container-high',
      )
      break
    case 'secondary':
      classes = cx(
        OUTLINE_BASE,
        FOCUS_PRIMARY,
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:border-outline-variant',
        sizeClass,
        tone === 'accent'
          ? 'border-primary/50 bg-surface-container-highest text-on-surface enabled:hover:border-primary'
          : 'border-outline-variant bg-surface-container-highest text-on-surface enabled:hover:border-primary/60',
      )
      break
    case 'danger':
      classes = cx(
        OUTLINE_BASE,
        FOCUS_DANGER,
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:border-outline/30',
        sizeClass,
        'border-status-error/40 text-status-error enabled:hover:border-status-error/60 enabled:hover:bg-status-error/10',
      )
      break
    case 'dangerFlat':
      classes = cx(
        'inline-flex items-center gap-1.5 rounded-lg border font-semibold transition-colors',
        FOCUS_DANGER,
        size === 'md' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1.5 text-[11px]',
        disabled
          ? 'border-outline/30 text-outline/60 cursor-not-allowed'
          : 'border-status-error/40 text-status-error hover:bg-status-error/10',
      )
      break
    case 'outlinePrimary':
      classes =
        'inline-flex items-center gap-2 text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-primary/50 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low'
      break
    case 'icon':
      classes = className ?? ICON_BUTTON_CLASS
      break
    default:
      classes = cx(
        BUTTON_BASE,
        'bg-primary-container text-on-primary-container hover:bg-primary-container/90 shadow-sm',
      )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={classes}
    >
      {icon}
      {children}
    </button>
  )
}

export interface StatRow {
  label: string
  value: ReactNode
  tone?: 'default' | 'muted'
}

export function StatStrip({ rows }: { rows: StatRow[] }) {
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
    </div>
  )
}

export function StatusPill({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'muted'
  children: ReactNode
}) {
  return (
    <span
      className={[
        'inline-flex items-center rounded px-2 py-0.5 font-mono text-label-xs font-bold uppercase',
        tone === 'ok'
          ? 'bg-emerald-500/10 text-emerald-400'
          : tone === 'warn'
            ? 'bg-amber-500/10 text-amber-300'
            : 'bg-surface-container-highest text-on-surface-variant',
      ].join(' ')}
    >
      {children}
    </span>
  )
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 && value > 0 ? Math.min(100, (value / max) * 100) : 0
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
        className="h-full bg-primary transition-all duration-500"
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
