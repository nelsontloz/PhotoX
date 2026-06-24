import { useEffect, useId, useState } from 'react'
import type { IconType } from 'react-icons'

type Accent = 'primary' | 'amber' | 'red'

interface AccentStyle {
  iconTint: string
  iconText: string
  iconRing: string
  glow: string
  pillBg: string
  pillText: string
  pillBorder: string
  dot: string
}

const ACCENTS: Record<Accent, AccentStyle> = {
  primary: {
    iconTint: 'bg-primary/10 dark:bg-primary/20',
    iconText: 'text-primary',
    iconRing: 'ring-primary/20',
    glow: 'bg-primary/30',
    pillBg: 'bg-primary/10 dark:bg-primary/15',
    pillText: 'text-primary',
    pillBorder: 'border-primary/20',
    dot: 'bg-primary',
  },
  amber: {
    iconTint: 'bg-amber-500/10 dark:bg-amber-500/15',
    iconText: 'text-amber-500 dark:text-amber-400',
    iconRing: 'ring-amber-500/25 dark:ring-amber-500/20',
    glow: 'bg-amber-500/25',
    pillBg: 'bg-amber-500/10 dark:bg-amber-500/15',
    pillText: 'text-amber-700 dark:text-amber-400',
    pillBorder: 'border-amber-500/25 dark:border-amber-500/20',
    dot: 'bg-amber-500',
  },
  red: {
    iconTint: 'bg-red-500/10 dark:bg-red-500/15',
    iconText: 'text-red-500 dark:text-red-400',
    iconRing: 'ring-red-500/25 dark:ring-red-500/20',
    glow: 'bg-red-500/25',
    pillBg: 'bg-red-500/10 dark:bg-red-500/15',
    pillText: 'text-red-600 dark:text-red-400',
    pillBorder: 'border-red-500/25 dark:border-red-500/20',
    dot: 'bg-red-500',
  },
}

export interface PlaceholderPageProps {
  icon: IconType
  title: string
  description: string
  accent?: Accent
  badge?: string
}

export function PlaceholderPage({
  icon: Icon,
  title,
  description,
  accent = 'primary',
  badge = 'Coming soon',
}: PlaceholderPageProps) {
  const headingId = useId()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const style = ACCENTS[accent]

  return (
    <section
      aria-labelledby={headingId}
      className={[
        'flex flex-col items-center justify-center',
        'py-20 sm:py-28 px-4 text-center max-w-xl mx-auto',
        'transition-all duration-500 ease-out',
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      ].join(' ')}
    >
      <div className="relative mb-8">
        <div
          className={['absolute inset-0 -m-6 rounded-full blur-3xl', style.glow].join(' ')}
          aria-hidden="true"
        />
        <div
          className={[
            'relative w-24 h-24 sm:w-28 sm:h-28 rounded-full',
            'flex items-center justify-center',
            'bg-slate-100 dark:bg-card-dark ring-1',
            style.iconTint,
            style.iconRing,
          ].join(' ')}
        >
          <Icon className={['text-4xl sm:text-5xl', style.iconText].join(' ')} aria-hidden="true" />
        </div>
      </div>

      <span
        className={[
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
          'text-[10px] font-bold uppercase tracking-wider',
          'border backdrop-blur-sm',
          style.pillBg,
          style.pillText,
          style.pillBorder,
        ].join(' ')}
      >
        <span className={['size-1.5 rounded-full', style.dot].join(' ')} aria-hidden="true" />
        {badge}
      </span>

      <h1
        id={headingId}
        className="mt-5 text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white"
      >
        {title}
      </h1>

      <p className="mt-4 text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed max-w-md">
        {description}
      </p>
    </section>
  )
}
