const SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const DATED = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export function formatShortDate(d: Date): string {
  return SHORT.format(d)
}

/** "Mar 1, 2024" — the full date used by the asset viewer top bar. */
export function formatDate(dateStr: string): string {
  return DATED.format(new Date(dateStr))
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

function labelFor(date: Date): string {
  const diff = daysDiff(new Date(), date)

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff <= 6) return formatShortDate(date)
  // ponytail: one section per day (see groupDateSortKey), so the label must be day-granular too —
  // a month-year fallback repeated the same header for every day of the month
  return DATED.format(date)
}

export function groupDateLabel(dateStr: string): string {
  return labelFor(new Date(dateStr))
}

export function groupDateSortKey(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Timeline effective date (backend COALESCE(takenAt, uploadedAt) equivalent).
export function effectiveAssetDate(a: { takenAt: string | null; uploadedAt: string }): string {
  return a.takenAt ?? a.uploadedAt
}

// YYYY-MM key (local calendar month) of an instant — the fetch unit of the timeline.
export function monthKeyOf(dateStr: string): string {
  return groupDateSortKey(dateStr).slice(0, 7)
}

/**
 * Half-open [from, to) ISO-instant range of a YYYY-MM key, as backend `dateFrom`/`dateTo`.
 * Built from local Date components (never a 'YYYY-MM-01T00:00:00Z' string) so the boundaries
 * are local midnights — DST-safe, and the month the user sees in the header is the month fetched.
 */
export function monthRange(monthKey: string): { dateFrom: string; dateTo: string } {
  const [y, m] = monthKey.split('-')
  const year = Number(y)
  const month = Number(m)
  if (!y || !m || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`invalid month key: ${monthKey}`)
  }
  return {
    dateFrom: new Date(year, month - 1, 1).toISOString(),
    // month 12 rolls into January of the next year naturally
    dateTo: new Date(year, month, 1).toISOString(),
  }
}

// Inverse of groupDateSortKey for days that only exist as a layout slot (assets not fetched yet):
// parse the YYYY-MM-DD key as a LOCAL date (a bare 'YYYY-MM-DD' string would parse as UTC and
// shift the label one day in negative offsets), then reuse groupDateLabel's Today/Yesterday rules.
export function groupDateLabelFromSortKey(sortKey: string): string {
  const [y, m, d] = sortKey.split('-')
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (!y || !m || !d || Number.isNaN(date.getTime())) return sortKey
  return labelFor(date)
}

const MONTH_LONG = new Intl.DateTimeFormat('en-US', { month: 'long' })

// "March 2024" pieces for the timeline scrubber popup — groupDateLabel is day-granular
// (Today / "Mar 1"), so a YYYY-MM bucket key formats straight from its own components.
export function monthYearLabel(monthKey: string): { month: string; year: string } {
  const [y, m] = monthKey.split('-')
  const year = Number(y)
  const month = Number(m)
  if (!y || !m || !Number.isInteger(year) || month < 1 || month > 12) {
    return { month: monthKey, year: '' }
  }
  return { month: MONTH_LONG.format(new Date(year, month - 1, 1)), year: String(year) }
}
