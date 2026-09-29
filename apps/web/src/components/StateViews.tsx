import type { ReactNode } from 'react'
import { FaSpinner } from 'react-icons/fa6'

/** Page-level spinner. `className` replaces the wrapper classes for pages that pad differently. */
export function LoadingState({
  className = 'flex items-center justify-center py-32',
}: {
  className?: string
}) {
  return (
    <div className={className}>
      <FaSpinner className="text-2xl text-primary animate-spin" />
    </div>
  )
}

/** Page-level error + Retry, with the page's own message string. */
export function ErrorState({
  message,
  onRetry,
  className = 'flex flex-col items-center justify-center py-32 gap-4',
  messageClassName = 'text-red-500',
}: {
  message: string
  onRetry: () => void
  className?: string
  messageClassName?: string
}) {
  return (
    <div className={className}>
      <p className={`text-sm ${messageClassName}`}>{message}</p>
      <button type="button" onClick={onRetry} className="text-primary text-sm font-medium hover:underline">
        Retry
      </button>
    </div>
  )
}

/** Centered "nothing here yet" hero: icon in a tinted circle, title, body copy. */
export function EmptyState({
  icon,
  circleClassName,
  title,
  body,
}: {
  icon: ReactNode
  circleClassName: string
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
      <div
        className={`mb-8 w-20 h-20 rounded-full ${circleClassName} flex items-center justify-center`}
      >
        {icon}
      </div>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
        {title}
      </h1>
      <p className="mt-4 text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed max-w-md">
        {body}
      </p>
    </div>
  )
}
