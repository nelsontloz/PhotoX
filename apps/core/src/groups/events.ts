import type { EventGroupDto } from '@photox/shared-types'

export interface EventSourceRow {
  id: string
  takenAt: Date | string
  placeCity: string | null
  placeCountryCode: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

// ponytail: one formatter for both label shapes; UTC + en-US month abbreviations keep labels
// stable regardless of server timezone. Swap to a locale setting only if the UI ever needs one.
export function formatEventLabel(placeCity: string | null, takenFrom: Date, takenTo: Date): string {
  if (placeCity) return `${placeCity} · ${monthYear(takenFrom)}`
  return `Untitled trip · ${dateRange(takenFrom, takenTo)}`
}

function monthYear(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

function monthDay(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

function dateRange(from: Date, to: Date): string {
  const sameDay =
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCDate() === to.getUTCDate()
  if (sameDay) return `${monthDay(from)}, ${from.getUTCFullYear()}`
  if (from.getUTCFullYear() === to.getUTCFullYear()) {
    // same month compacts to "Jun 3 – 5, 2026"; different months keep both names
    if (from.getUTCMonth() === to.getUTCMonth()) {
      return `${monthDay(from)} – ${dayOfMonth(to)}, ${from.getUTCFullYear()}`
    }
    return `${monthDay(from)} – ${monthDay(to)}, ${from.getUTCFullYear()}`
  }
  return `${monthDay(from)}, ${from.getUTCFullYear()} – ${monthDay(to)}, ${to.getUTCFullYear()}`
}

function dayOfMonth(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'UTC' }).format(d)
}

/**
 * Split chronologically-ordered photo rows into trip groups: a new group starts when the gap
 * exceeds `gapDays` or placeCity changes (NULL is its own bucket value, grouped contiguously).
 * Returns groups newest-first; `coverAssetId` is the latest asset of each group.
 *
 * ponytail: in-memory split over one ordered query — fine at personal-library scale; move to a
 * SQL window function if a library ever outgrows a single pass.
 */
export function splitEvents(rows: EventSourceRow[], gapDays: number): EventGroupDto[] {
  const groups: EventGroupDto[] = []
  let current: EventSourceRow[] = []
  let currentCity: string | null = null
  let currentTime = 0

  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]!
    const last = current[current.length - 1]!
    const from = new Date(first.takenAt)
    const to = new Date(last.takenAt)
    groups.push({
      // stable listing key, not a resource id
      id: `${from.toISOString()}_${first.placeCity ?? 'any'}`,
      label: formatEventLabel(first.placeCity, from, to),
      takenFrom: from.toISOString(),
      takenTo: to.toISOString(),
      placeCity: first.placeCity,
      placeCountryCode: first.placeCountryCode,
      count: current.length,
      coverAssetId: last.id,
    })
  }

  for (const row of rows) {
    const time = new Date(row.takenAt).getTime()
    if (current.length > 0) {
      const cityChanged = row.placeCity !== currentCity
      const gapExceeded = time - currentTime > gapDays * DAY_MS
      if (cityChanged || gapExceeded) {
        flush()
        current = []
      }
    }
    if (current.length === 0) currentCity = row.placeCity
    current.push(row)
    currentTime = time
  }
  flush()

  return groups.reverse()
}
