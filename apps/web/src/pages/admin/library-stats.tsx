import { useEffect, useState, type ReactNode } from 'react'
import {
  FaArrowsRotate,
  FaCamera,
  FaChartPie,
  FaFilm,
  FaHardDrive,
  FaTrashCan,
} from 'react-icons/fa6'
import { getAdminLibraryStats } from '../../api/admin'
import { formatBytes } from '../../lib/format'
import type {
  AdminLibraryStatsResponse,
  AdminLibraryStorageMonth,
  AdminLibraryUploadsWeek,
} from '@photox/shared-types'

// --- pure transforms (spec'd in library-stats.spec.ts) ---

/** Human-readable storage; formatBytes returns null for 0/negative, charts want a real string. */
export function formatStorage(bytes: number): string {
  return formatBytes(bytes) ?? '0 B'
}

export interface CumulativeStorageMonth {
  month: string
  originalsBytes: number
  transcodesBytes: number
  thumbnailsBytes: number
}

/** Running totals per month: storageByMonth holds per-month additions, charts need growth. */
export function toCumulative(rows: AdminLibraryStorageMonth[]): CumulativeStorageMonth[] {
  let originals = 0
  let transcodes = 0
  let thumbnails = 0
  return rows.map((row) => {
    originals += row.originalsBytes
    transcodes += row.transcodesBytes
    thumbnails += row.thumbnailsBytes
    return {
      month: row.month,
      originalsBytes: originals,
      transcodesBytes: transcodes,
      thumbnailsBytes: thumbnails,
    }
  })
}

/** value -> pixel height against a max; a max of 0 must yield 0, never NaN. */
export function scaleToHeight(value: number, max: number, maxHeight: number): number {
  if (!(max > 0) || !(value > 0)) return 0
  return Math.min(maxHeight, (value / max) * maxHeight)
}

// --- chart geometry (fixed viewBox; SVG scales to the card width) ---

const VIEW_W = 360
const VIEW_H = 200
const PAD_LEFT = 44
const PAD_RIGHT = 8
const PAD_TOP = 12
const PAD_BOTTOM = 26
const PLOT_X = PAD_LEFT
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT
const PLOT_BOTTOM = VIEW_H - PAD_BOTTOM
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM
const PLOT_MID_Y = PAD_TOP + PLOT_H / 2

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function shortMonth(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  })
}

function AxisText({
  x,
  y,
  anchor,
  children,
}: {
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
  children: string
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={10} className="fill-slate-500">
      {children}
    </text>
  )
}

function ChartCard({
  title,
  hint,
  legend,
  children,
}: {
  title: string
  hint: string
  legend: { label: string; dotClass: string }[]
  children: ReactNode
}) {
  return (
    <div className="bg-card-dark border border-border-dark rounded-xl p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{hint}</span>
      </div>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${l.dotClass}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function EmptyChartNote({ text }: { text: string }) {
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto" role="img" aria-label={text}>
      <line
        x1={PLOT_X}
        x2={VIEW_W - PAD_RIGHT}
        y1={PLOT_BOTTOM}
        y2={PLOT_BOTTOM}
        className="stroke-slate-600"
        strokeWidth={1}
      />
      <text
        x={PLOT_X + PLOT_W / 2}
        y={PLOT_MID_Y}
        textAnchor="middle"
        fontSize={11}
        className="fill-slate-500"
      >
        {text}
      </text>
    </svg>
  )
}

function UploadsChart({ weeks }: { weeks: AdminLibraryUploadsWeek[] }) {
  const max = weeks.reduce((m, w) => Math.max(m, w.photos + w.videos), 0)
  if (weeks.length === 0 || max === 0) {
    return <EmptyChartNote text="No uploads in the last 26 weeks." />
  }

  const slot = PLOT_W / weeks.length
  const barW = Math.max(3, Math.min(slot * 0.7, 14))
  const ticks = [...new Set([0, Math.round(max / 2), max])]
  const labelIdx = [...new Set([0, Math.floor((weeks.length - 1) / 2), weeks.length - 1])]

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Uploads per week, photos and videos"
    >
      {ticks.map((t) => {
        const y = PLOT_BOTTOM - scaleToHeight(t, max, PLOT_H)
        return (
          <g key={t}>
            <line
              x1={PLOT_X}
              x2={VIEW_W - PAD_RIGHT}
              y1={y}
              y2={y}
              className="stroke-border-dark"
              strokeWidth={1}
            />
            <AxisText x={PLOT_X - 6} y={y + 3} anchor="end">
              {t.toLocaleString()}
            </AxisText>
          </g>
        )
      })}
      {weeks.map((w, i) => {
        const hP = scaleToHeight(w.photos, max, PLOT_H)
        const hV = scaleToHeight(w.videos, max, PLOT_H)
        const x = PLOT_X + i * slot + (slot - barW) / 2
        const yP = PLOT_BOTTOM - hP
        const yV = yP - hV
        return (
          <g key={w.week}>
            <title>{`${shortDate(w.week)}: ${w.photos} photos, ${w.videos} videos`}</title>
            {hP > 0 && (
              <rect x={x} y={yP} width={barW} height={hP} rx={1} className="fill-primary" />
            )}
            {hV > 0 && (
              <rect x={x} y={yV} width={barW} height={hV} rx={1} className="fill-amber-400" />
            )}
          </g>
        )
      })}
      {labelIdx.map((i) => {
        const w = weeks[i]
        if (!w) return null
        const first = i === 0
        const last = i === weeks.length - 1
        const x = first ? PLOT_X : last ? PLOT_X + (i + 1) * slot : PLOT_X + (i + 0.5) * slot
        return (
          <AxisText
            key={w.week}
            x={x}
            y={PLOT_BOTTOM + 15}
            anchor={first ? 'start' : last ? 'end' : 'middle'}
          >
            {shortDate(w.week)}
          </AxisText>
        )
      })}
    </svg>
  )
}

function StorageChart({ months }: { months: AdminLibraryStorageMonth[] }) {
  const rows = toCumulative(months)
  const max = rows.reduce(
    (m, r) => Math.max(m, r.originalsBytes + r.transcodesBytes + r.thumbnailsBytes),
    0,
  )
  if (max === 0) return <EmptyChartNote text="No stored files yet." />
  if (rows.length < 2) return <EmptyChartNote text="Not enough history to chart growth yet." />

  const xAt = (i: number) => PLOT_X + (i / (rows.length - 1)) * PLOT_W
  const yAt = (v: number) => PLOT_BOTTOM - scaleToHeight(v, max, PLOT_H)
  const ticks = [...new Set([0, Math.round(max / 2), max])]
  const last = rows.length - 1
  const labelIdx = [...new Set([0, Math.floor(last / 2), last])]

  const band = (
    top: (r: CumulativeStorageMonth) => number,
    bottom: (r: CumulativeStorageMonth) => number,
  ): string => {
    const up = rows.map(
      (r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(top(r)).toFixed(2)}`,
    )
    const down = rows
      .map((r, i) => ({ r, i }))
      .reverse()
      .map(({ r, i }) => `L${xAt(i).toFixed(2)},${yAt(bottom(r)).toFixed(2)}`)
    return `${up.join(' ')} ${down.join(' ')} Z`
  }

  const sumTop = (r: CumulativeStorageMonth) => r.originalsBytes + r.transcodesBytes
  const sumAll = (r: CumulativeStorageMonth) => sumTop(r) + r.thumbnailsBytes
  const bands = [
    {
      key: 'originals',
      d: band(
        (r) => r.originalsBytes,
        () => 0,
      ),
      cls: 'fill-primary stroke-primary',
    },
    {
      key: 'transcodes',
      d: band(sumTop, (r) => r.originalsBytes),
      cls: 'fill-amber-400 stroke-amber-400',
    },
    {
      key: 'thumbnails',
      d: band(sumAll, sumTop),
      cls: 'fill-emerald-400 stroke-emerald-400',
    },
  ]

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Cumulative storage growth by month"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PLOT_X}
            x2={VIEW_W - PAD_RIGHT}
            y1={yAt(t)}
            y2={yAt(t)}
            className="stroke-border-dark"
            strokeWidth={1}
          />
          <AxisText x={PLOT_X - 6} y={yAt(t) + 3} anchor="end">
            {formatStorage(t)}
          </AxisText>
        </g>
      ))}
      {bands.map((b) => (
        <path
          key={b.key}
          d={b.d}
          className={b.cls}
          fillOpacity={0.32}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ))}
      {labelIdx.map((i) => {
        const row = rows[i]
        if (!row) return null
        const first = i === 0
        const isLast = i === last
        return (
          <AxisText
            key={row.month}
            x={first ? PLOT_X : isLast ? VIEW_W - PAD_RIGHT : xAt(i)}
            y={PLOT_BOTTOM + 15}
            anchor={first ? 'start' : isLast ? 'end' : 'middle'}
          >
            {shortMonth(row.month)}
          </AxisText>
        )
      })}
    </svg>
  )
}

function SummaryTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof FaCamera
}) {
  return (
    <div className="bg-slate-900/40 border border-border-dark rounded-lg p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="text-[11px]" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-100">{value}</p>
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="bg-card-dark border border-border-dark rounded-xl p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="h-3 w-20 rounded bg-slate-700 animate-pulse mb-3" />
              <div className="h-7 w-24 rounded bg-slate-700 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-card-dark border border-border-dark rounded-xl p-5">
            <div className="h-4 w-32 rounded bg-slate-700 animate-pulse mb-4" />
            <div className="h-44 w-full rounded bg-slate-700/50 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function LibraryStatsSection() {
  const [data, setData] = useState<AdminLibraryStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getAdminLibraryStats()
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load library stats')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [version])

  const retry = () => setVersion((v) => v + 1)

  const split = data
    ? data.storageByMonth.reduce(
        (acc, m) => ({
          originals: acc.originals + m.originalsBytes,
          transcodes: acc.transcodes + m.transcodesBytes,
          thumbnails: acc.thumbnails + m.thumbnailsBytes,
        }),
        { originals: 0, transcodes: 0, thumbnails: 0 },
      )
    : { originals: 0, transcodes: 0, thumbnails: 0 }
  const totalBytes = split.originals + split.transcodes + split.thumbnails
  const splitItems = [
    { label: 'Originals', bytes: split.originals, dot: 'bg-primary' },
    { label: 'Transcodes', bytes: split.transcodes, dot: 'bg-amber-400' },
    { label: 'Thumbnails', bytes: split.thumbnails, dot: 'bg-emerald-400' },
  ]
  const emptyLibrary =
    data !== null &&
    data.counts.photos === 0 &&
    data.counts.videos === 0 &&
    data.counts.trashed === 0

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FaChartPie className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Library stats</h2>
        </div>
        <button
          type="button"
          aria-label="Refresh library stats"
          onClick={retry}
          className="text-slate-400 hover:text-slate-200 transition-colors"
        >
          <FaArrowsRotate />
        </button>
      </div>

      {loading ? (
        <StatsSkeleton />
      ) : error ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-4 text-center">
          <p className="text-xs text-red-400 mb-2">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="text-xs font-medium text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="space-y-4">
          <div className="bg-card-dark border border-border-dark rounded-xl p-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryTile
                label="Photos"
                value={data.counts.photos.toLocaleString()}
                icon={FaCamera}
              />
              <SummaryTile
                label="Videos"
                value={data.counts.videos.toLocaleString()}
                icon={FaFilm}
              />
              <SummaryTile
                label="Trashed"
                value={data.counts.trashed.toLocaleString()}
                icon={FaTrashCan}
              />
              <SummaryTile
                label="Total storage"
                value={formatStorage(totalBytes)}
                icon={FaHardDrive}
              />
            </div>
            <div className="mt-4 pt-4 border-t border-border-dark flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Storage split
              </span>
              {splitItems.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.dot}`} />
                  {s.label}
                  <span className="text-slate-200 tabular-nums">{formatStorage(s.bytes)}</span>
                  <span className="text-slate-500 tabular-nums">
                    ({totalBytes > 0 ? ((s.bytes / totalBytes) * 100).toFixed(1) : '0.0'}%)
                  </span>
                </span>
              ))}
            </div>
            {emptyLibrary && <p className="mt-3 text-xs text-slate-500">The library is empty.</p>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard
              title="Uploads per week"
              hint="Last 26 weeks"
              legend={[
                { label: 'Photos', dotClass: 'bg-primary' },
                { label: 'Videos', dotClass: 'bg-amber-400' },
              ]}
            >
              <UploadsChart weeks={data.uploadsByWeek} />
            </ChartCard>
            <ChartCard
              title="Storage growth"
              hint="Cumulative by month"
              legend={[
                { label: 'Originals', dotClass: 'bg-primary' },
                { label: 'Transcodes', dotClass: 'bg-amber-400' },
                { label: 'Thumbnails', dotClass: 'bg-emerald-400' },
              ]}
            >
              <StorageChart months={data.storageByMonth} />
            </ChartCard>
          </div>
        </div>
      ) : null}
    </section>
  )
}
