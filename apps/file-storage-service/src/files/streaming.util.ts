export const RANGE_RE = /^bytes=(\d+)-(\d*)$/

export function parseRangeHeader(
  rangeHeader: string,
  totalSize: number,
): { start: number; end: number } | null {
  const match = RANGE_RE.exec(rangeHeader)
  if (!match) return null
  const start = Number(match[1])
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return null
  const endStr = match[2]
  const end = endStr ? Number(endStr) : totalSize - 1
  if (!Number.isFinite(end) || end < start) {
    return { start, end: totalSize - 1 }
  }
  return { start, end: Math.min(end, totalSize - 1) }
}
