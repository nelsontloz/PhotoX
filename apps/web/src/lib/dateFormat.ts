const SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const DATED = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export function formatShortDate(d: Date): string {
  return SHORT.format(d)
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function daysDiff(a: Date, b: Date): number {
  const msPerDay = 86_400_000
  const startA = startOfDay(a).getTime()
  const startB = startOfDay(b).getTime()
  return Math.round((startA - startB) / msPerDay)
}

export function groupDateLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = daysDiff(now, date)

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff <= 6) return formatShortDate(date)
  // ponytail: one section per day (see groupDateSortKey), so the label must be day-granular too —
  // a month-year fallback repeated the same header for every day of the month
  return DATED.format(date)
}

export function groupDateSortKey(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
