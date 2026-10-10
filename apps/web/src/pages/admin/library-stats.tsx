import { useEffect, useState } from 'react'
import {
  FaCamera,
  FaChartColumn,
  FaChartLine,
  FaChartPie,
  FaFilm,
  FaHardDrive,
  FaTrashCan,
} from 'react-icons/fa6'
import { getAdminAssetCounts, getAdminLibraryStats } from '../../api/admin'
import { formatBytes } from '../../lib/format'
import { Skeleton } from '../../components/Skeleton'
import { AdminCard, AdminSection, GhostButton, MetricTile, RefreshButton, cx } from './ui'
import type {
  AdminAssetCountsResponse,
  AdminLibraryCounts,
  AdminLibraryStatsResponse,
  AdminLibraryStorageMonth,
  AdminLibraryUploadsWeek,
  AssetFailureCounts,
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

/**
 * Share of active photos whose pipeline finished cleanly: 100% minus the fraction still stuck in
 * processing/metadata/thumbnails (encoding is video-only). Clamped 0–100; `max(1, photos)` keeps
 * an empty library from dividing by zero.
 */
export function indexedPercent(counts: AdminLibraryCounts, failures: AssetFailureCounts): number {
  const incomplete = failures.processing + failures.metadata + failures.thumbnails
  const percent = 100 - Math.round((incomplete / Math.max(1, counts.photos)) * 100)
  return Math.min(100, Math.max(0, percent))
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

// Stable (not per-render) so two mounted charts could never fight over the same defs id.
const STORAGE_AREA_GRADIENT_ID = 'library-stats-storage-area'

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
    <text x={x} y={y} textAnchor={anchor} fontSize={10} className="fill-outline">
      {children}
    </text>
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
        className="stroke-border-dark"
        strokeWidth={1}
      />
      <text
        x={PLOT_X + PLOT_W / 2}
        y={PLOT_MID_Y}
        textAnchor="middle"
        fontSize={11}
        className="fill-outline"
      >
        {text}
      </text>
    </svg>
  )
}

function ChartLegend({ items }: { items: { label: string; dot: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cx('inline-block w-2.5 h-2.5 rounded-full', item.dot)} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

const UPLOAD_LEGEND = [
  { label: 'Photos', dot: 'bg-primary' },
  { label: 'Videos', dot: 'bg-tertiary-fixed-dim' },
]

const STORAGE_LEGEND = [
  { label: 'Originals', dot: 'bg-primary' },
  { label: 'Transcodes', dot: 'bg-secondary-fixed' },
  { label: 'Thumbnails', dot: 'bg-tertiary-fixed-dim' },
]

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
              className="stroke-surface-container-highest"
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
              <rect
                x={x}
                y={yV}
                width={barW}
                height={hV}
                rx={1}
                className="fill-tertiary-fixed-dim"
              />
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
  const totalOf = (row: CumulativeStorageMonth) =>
    row.originalsBytes + row.transcodesBytes + row.thumbnailsBytes
  const max = rows.reduce((m, row) => Math.max(m, totalOf(row)), 0)
  if (max === 0) return <EmptyChartNote text="No stored files yet." />
  if (rows.length < 2) return <EmptyChartNote text="Not enough history to chart growth yet." />

  const xAt = (i: number) => PLOT_X + (i / (rows.length - 1)) * PLOT_W
  const yAt = (value: number) => PLOT_BOTTOM - scaleToHeight(value, max, PLOT_H)
  const ticks = [...new Set([0, Math.round(max / 2), max])]
  const lastIndex = rows.length - 1
  const labelIdx = [...new Set([0, Math.floor(lastIndex / 2), lastIndex])]

  const band = (
    top: (row: CumulativeStorageMonth) => number,
    bottom: (row: CumulativeStorageMonth) => number,
  ): string => {
    const up = rows.map(
      (row, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(top(row)).toFixed(2)}`,
    )
    const down = rows
      .map((row, i) => ({ row, i }))
      .reverse()
      .map(({ row, i }) => `L${xAt(i).toFixed(2)},${yAt(bottom(row)).toFixed(2)}`)
    return `${up.join(' ')} ${down.join(' ')} Z`
  }

  const sumTop = (row: CumulativeStorageMonth) => row.originalsBytes + row.transcodesBytes
  const bands = [
    {
      key: 'Originals',
      d: band(
        (row) => row.originalsBytes,
        () => 0,
      ),
      cls: 'fill-primary',
      bytes: (row: CumulativeStorageMonth) => row.originalsBytes,
    },
    {
      key: 'Transcodes',
      d: band(sumTop, (row) => row.originalsBytes),
      cls: 'fill-secondary-fixed',
      bytes: (row: CumulativeStorageMonth) => row.transcodesBytes,
    },
    {
      key: 'Thumbnails',
      d: band(totalOf, sumTop),
      cls: 'fill-tertiary-fixed-dim',
      bytes: (row: CumulativeStorageMonth) => row.thumbnailsBytes,
    },
  ]
  const linePath = rows
    .map((row, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(totalOf(row)).toFixed(2)}`)
    .join(' ')
  const lastRow = rows[lastIndex]

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Cumulative storage growth by month"
    >
      <defs>
        <linearGradient id={STORAGE_AREA_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--color-primary)' }} stopOpacity={0.3} />
          <stop offset="100%" style={{ stopColor: 'var(--color-primary)' }} stopOpacity={0} />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PLOT_X}
            x2={VIEW_W - PAD_RIGHT}
            y1={yAt(t)}
            y2={yAt(t)}
            className="stroke-surface-container-highest"
            strokeWidth={1}
          />
          <AxisText x={PLOT_X - 6} y={yAt(t) + 3} anchor="end">
            {formatStorage(t)}
          </AxisText>
        </g>
      ))}
      <path d={band(totalOf, () => 0)} fill={`url(#${STORAGE_AREA_GRADIENT_ID})`}>
        <title>
          {lastRow ? `Total stored: ${formatStorage(totalOf(lastRow))}` : 'Total stored'}
        </title>
      </path>
      {bands.map((b) => (
        <path key={b.key} d={b.d} className={b.cls} fillOpacity={0.16}>
          <title>{lastRow ? `${b.key}: ${formatStorage(b.bytes(lastRow))}` : b.key}</title>
        </path>
      ))}
      <path
        d={linePath}
        fill="none"
        className="stroke-primary"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {lastRow && (
        <circle cx={xAt(lastIndex)} cy={yAt(totalOf(lastRow))} r={3.5} className="fill-primary" />
      )}
      {labelIdx.map((i) => {
        const row = rows[i]
        if (!row) return null
        const first = i === 0
        const isLast = i === lastIndex
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

/** Segmented storage bar: flexGrow proportional to bytes, tiny non-zero slices stay visible. */
function AllocationBar({
  segments,
}: {
  segments: { key: string; bytes: number; className: string }[]
}) {
  const total = segments.reduce((sum, segment) => sum + segment.bytes, 0)
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-surface-container-highest flex gap-0.5">
      {segments.map((segment) => {
        const share = scaleToHeight(segment.bytes, total, 100)
        const visible = segment.bytes > 0
        return (
          <div
            key={segment.key}
            title={`${segment.key}: ${formatStorage(segment.bytes)}`}
            className={cx('h-full rounded-full', segment.className)}
            style={{
              flexGrow: share,
              flexBasis: visible ? 2 : 0,
              minWidth: visible ? 2 : 0,
            }}
          />
        )
      })}
    </div>
  )
}

function TileSkeleton() {
  return (
    <AdminCard>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-4 h-9 w-28" />
      <Skeleton className="mt-4 h-1 w-full" />
    </AdminCard>
  )
}

function ChartSkeleton() {
  return (
    <AdminCard>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3.5 w-44" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-52 w-full" />
    </AdminCard>
  )
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <ChartSkeleton />
        </div>
        <div className="lg:col-span-5">
          <ChartSkeleton />
        </div>
      </div>
    </div>
  )
}

export function LibraryStatsSection() {
  const [data, setData] = useState<AdminLibraryStatsResponse | null>(null)
  const [assetCounts, setAssetCounts] = useState<AdminAssetCountsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAssetCounts(null)
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
    // Optional enrichment (photos tile meta + bar); a failure here must never affect the stats.
    getAdminAssetCounts()
      .then((res) => {
        if (!cancelled) setAssetCounts(res)
      })
      .catch(() => {
        // leave assetCounts null: the photos tile falls back to no meta and a 0 bar
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
  const photosIndexed = data && assetCounts ? indexedPercent(data.counts, assetCounts.photos) : null
  const splitItems = [
    { label: 'Originals', bytes: split.originals, dot: 'bg-primary' },
    { label: 'Transcodes', bytes: split.transcodes, dot: 'bg-secondary-fixed' },
    { label: 'Thumbnails', bytes: split.thumbnails, dot: 'bg-tertiary-fixed-dim' },
  ]
  const emptyLibrary =
    data !== null &&
    data.counts.photos === 0 &&
    data.counts.videos === 0 &&
    data.counts.trashed === 0

  return (
    <AdminSection
      card={false}
      title="Library stats"
      subtitle="Uploads, storage growth, and library composition"
      icon={<FaChartPie />}
      actions={
        <RefreshButton
          onClick={retry}
          label="Refresh library stats"
          className="inline-flex items-center rounded-lg bg-surface-container p-2 text-on-surface transition-colors hover:bg-surface-container-high"
        />
      }
    >
      {loading ? (
        <StatsSkeleton />
      ) : error ? (
        <AdminCard className="text-center">
          <p className="mb-3 text-xs text-status-error">{error}</p>
          <GhostButton onClick={retry}>Retry</GhostButton>
        </AdminCard>
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricTile
              label="Photos"
              icon={<FaCamera />}
              value={data.counts.photos.toLocaleString()}
              meta={photosIndexed != null ? `${photosIndexed}% indexed` : undefined}
              barPercent={photosIndexed ?? undefined}
            />
            <MetricTile
              label="Videos"
              icon={<FaFilm />}
              value={data.counts.videos.toLocaleString()}
            />
            <MetricTile
              label="Trashed"
              icon={<FaTrashCan />}
              value={data.counts.trashed.toLocaleString()}
            />
            <MetricTile
              label="Allocated storage"
              icon={<FaHardDrive />}
              value={formatStorage(totalBytes)}
              meta={
                <span className="flex flex-col items-end gap-0.5 text-[11px] leading-tight">
                  <span>{formatStorage(split.originals)} orig</span>
                  <span>{formatStorage(split.transcodes)} trans</span>
                  <span>{formatStorage(split.thumbnails)} thumbs</span>
                </span>
              }
              bar={
                <div className="mt-4">
                  <AllocationBar
                    segments={splitItems.map((item) => ({
                      key: item.label,
                      bytes: item.bytes,
                      className: item.dot,
                    }))}
                  />
                </div>
              }
            />
          </div>

          <div className="rounded-lg bg-surface-container px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-label-xs uppercase tracking-wider text-outline">
                Storage allocation
              </span>
              {splitItems.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-1.5 text-on-surface-variant"
                >
                  <span className={cx('w-2.5 h-2.5 rounded-full', item.dot)} />
                  {item.label}
                  <span className="font-mono text-on-surface">{formatStorage(item.bytes)}</span>
                  <span className="text-[11px] text-outline">
                    {totalBytes > 0 ? ((item.bytes / totalBytes) * 100).toFixed(1) : '0.0'}%
                  </span>
                </span>
              ))}
            </div>
            {emptyLibrary && (
              <span className="text-[11px] text-outline">The library is empty.</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <AdminSection
              className="lg:col-span-7"
              headingTag="h3"
              title="Uploads per week"
              subtitle="Weekly photo and video uploads"
              icon={<FaChartColumn />}
              badge="Last 26 weeks"
            >
              <UploadsChart weeks={data.uploadsByWeek} />
              <ChartLegend items={UPLOAD_LEGEND} />
            </AdminSection>
            <AdminSection
              className="lg:col-span-5"
              headingTag="h3"
              title="Storage growth"
              subtitle="Total stored bytes by category"
              icon={<FaChartLine />}
              badge="Cumulative by month"
            >
              <StorageChart months={data.storageByMonth} />
              <ChartLegend items={STORAGE_LEGEND} />
            </AdminSection>
          </div>
        </div>
      ) : null}
    </AdminSection>
  )
}
