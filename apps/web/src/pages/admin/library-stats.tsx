import { useState } from 'react';
import {
  FaArrowsRotate,
  FaCamera,
  FaChartColumn,
  FaChartLine,
  FaChartPie,
  FaFilm,
  FaHardDrive,
  FaTrashCan,
} from 'react-icons/fa6';
import { getAdminAssetCounts, getAdminLibraryStats } from '../../api/admin';
import { formatBytes } from '../../lib/format';
import { formatIsoDate } from '../../lib/dateFormat';
import { AdminCard, AdminSection, Button, MetricTile, cx } from './ui';
import { useAsyncFetch } from '../../hooks/useAsyncFetch';
import type {
  AdminAssetCountsResponse,
  AdminLibraryCounts,
  AdminLibraryStorageMonth,
  AssetFailureCounts,
} from '@photox/shared-types';

// --- pure transforms (spec'd in library-stats.spec.ts) ---

/** Human-readable storage; formatBytes returns null for 0/negative, bars want a real string. */
export function formatStorage(bytes: number): string {
  return formatBytes(bytes) ?? '0 B';
}

export interface CumulativeStorageMonth {
  month: string;
  originalsBytes: number;
  transcodesBytes: number;
  thumbnailsBytes: number;
}

/** Running totals per month: storageByMonth holds per-month additions, the list shows growth. */
export function toCumulative(rows: AdminLibraryStorageMonth[]): CumulativeStorageMonth[] {
  let originals = 0;
  let transcodes = 0;
  let thumbnails = 0;
  return rows.map((row) => {
    originals += row.originalsBytes;
    transcodes += row.transcodesBytes;
    thumbnails += row.thumbnailsBytes;
    return {
      month: row.month,
      originalsBytes: originals,
      transcodesBytes: transcodes,
      thumbnailsBytes: thumbnails,
    };
  });
}

/** value -> share of a max; a max of 0 must yield 0, never NaN. */
export function scaleToHeight(value: number, max: number, maxHeight: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(maxHeight, (value / max) * maxHeight);
}

/**
 * Share of active photos whose pipeline finished cleanly: 100% minus the fraction still stuck in
 * processing/metadata/thumbnails (encoding is video-only). Clamped 0–100; `max(1, photos)` keeps
 * an empty library from dividing by zero.
 */
export function indexedPercent(counts: AdminLibraryCounts, failures: AssetFailureCounts): number {
  const incomplete = failures.processing + failures.metadata + failures.thumbnails;
  const percent = 100 - Math.round((incomplete / Math.max(1, counts.photos)) * 100);
  return Math.min(100, Math.max(0, percent));
}

/**
 * Segmented bar: flexGrow proportional to the value, tiny non-zero slices stay visible.
 * `format` labels the hover titles — bytes for storage, plain counts for upload tallies.
 */
function AllocationBar({
  segments,
  format = formatStorage,
}: {
  segments: { key: string; bytes: number; className: string }[];
  format?: (value: number) => string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-surface-container-highest flex gap-0.5">
      {segments.map((segment) => {
        const share = scaleToHeight(segment.bytes, total, 100);
        const visible = segment.bytes > 0;
        return (
          <div
            key={segment.key}
            title={`${segment.key}: ${format(segment.bytes)}`}
            className={cx('h-full rounded-full', segment.className)}
            style={{
              flexGrow: share,
              flexBasis: visible ? 2 : 0,
              minWidth: visible ? 2 : 0,
            }}
          />
        );
      })}
    </div>
  );
}

function TileSkeleton() {
  return (
    <AdminCard>
      <div className="animate-pulse bg-slate-700/50 rounded h-3.5 w-24" />
      <div className="animate-pulse bg-slate-700/50 rounded mt-4 h-9 w-28" />
      <div className="animate-pulse bg-slate-700/50 rounded mt-4 h-1 w-full" />
    </AdminCard>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
      <div className="animate-pulse bg-slate-700/50 rounded h-11 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <AdminCard className="lg:col-span-7">
          <div className="animate-pulse bg-slate-700/50 rounded h-52 w-full" />
        </AdminCard>
        <AdminCard className="lg:col-span-5">
          <div className="animate-pulse bg-slate-700/50 rounded h-52 w-full" />
        </AdminCard>
      </div>
    </div>
  );
}

export function LibraryStatsSection() {
  const [assetCounts, setAssetCounts] = useState<AdminAssetCountsResponse | null>(null);
  const [version, setVersion] = useState(0);

  const {
    data: stats,
    loading,
    error,
  } = useAsyncFetch(
    async () => {
      setAssetCounts(null);
      // Optional enrichment (photos tile meta + bar); a failure here must never affect the stats.
      const counts = getAdminAssetCounts().catch(() => null);
      const [next, nextCounts] = await Promise.all([getAdminLibraryStats(), counts]);
      setAssetCounts(nextCounts);
      return next;
    },
    { refreshKey: version, errorMessage: 'Failed to load library stats', loadingMode: 'always' },
  );
  const data = stats ?? null;

  const retry = () => setVersion((v) => v + 1);

  const split = data
    ? data.storageByMonth.reduce(
        (acc, m) => ({
          originals: acc.originals + m.originalsBytes,
          transcodes: acc.transcodes + m.transcodesBytes,
          thumbnails: acc.thumbnails + m.thumbnailsBytes,
        }),
        { originals: 0, transcodes: 0, thumbnails: 0 },
      )
    : { originals: 0, transcodes: 0, thumbnails: 0 };
  const totalBytes = split.originals + split.transcodes + split.thumbnails;
  const photosIndexed =
    data && assetCounts ? indexedPercent(data.counts, assetCounts.photos) : null;
  const splitItems = [
    { label: 'Originals', bytes: split.originals, dot: 'bg-primary' },
    { label: 'Transcodes', bytes: split.transcodes, dot: 'bg-secondary-fixed' },
    { label: 'Thumbnails', bytes: split.thumbnails, dot: 'bg-tertiary-fixed-dim' },
  ];
  const emptyLibrary =
    data !== null &&
    data.counts.photos === 0 &&
    data.counts.videos === 0 &&
    data.counts.trashed === 0;
  const hasUploads = data?.uploadsByWeek.some((w) => w.photos + w.videos > 0) ?? false;
  const storageRows = data ? toCumulative(data.storageByMonth) : [];

  return (
    <AdminSection
      card={false}
      title="Library stats"
      subtitle="Uploads, storage growth, and library composition"
      icon={<FaChartPie />}
      actions={
        <Button
          variant="icon"
          onClick={retry}
          ariaLabel="Refresh library stats"
          className="inline-flex items-center rounded-lg bg-surface-container p-2 text-on-surface transition-colors hover:bg-surface-container-high"
          icon={<FaArrowsRotate />}
        />
      }
    >
      {loading ? (
        <StatsSkeleton />
      ) : error ? (
        <AdminCard className="text-center">
          <p className="mb-3 text-xs text-status-error">{error}</p>
          <Button variant="ghost" onClick={retry}>
            Retry
          </Button>
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
              {hasUploads ? (
                <>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {data.uploadsByWeek.map((week) => (
                      <div key={week.week} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-on-surface-variant">
                            {formatIsoDate(week.week, { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="font-mono text-on-surface">
                            {week.photos.toLocaleString()} photos · {week.videos.toLocaleString()}{' '}
                            videos
                          </span>
                        </div>
                        <AllocationBar
                          format={(value) => value.toLocaleString()}
                          segments={[
                            { key: 'Photos', bytes: week.photos, className: 'bg-primary' },
                            {
                              key: 'Videos',
                              bytes: week.videos,
                              className: 'bg-tertiary-fixed-dim',
                            },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                      Photos
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-tertiary-fixed-dim" />
                      Videos
                    </span>
                  </div>
                </>
              ) : (
                <p className="py-6 text-center text-xs text-outline">
                  No uploads in the last 26 weeks.
                </p>
              )}
            </AdminSection>
            <AdminSection
              className="lg:col-span-5"
              headingTag="h3"
              title="Storage growth"
              subtitle="Total stored bytes by category"
              icon={<FaChartLine />}
              badge="Cumulative by month"
            >
              {totalBytes > 0 ? (
                <div className="space-y-3">
                  {storageRows.map((row) => (
                    <div key={row.month} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-on-surface-variant">
                          {formatIsoDate(row.month, { month: 'short', year: '2-digit' })}
                        </span>
                        <span className="font-mono text-on-surface">
                          {formatStorage(
                            row.originalsBytes + row.transcodesBytes + row.thumbnailsBytes,
                          )}
                        </span>
                      </div>
                      <AllocationBar
                        segments={[
                          { key: 'Originals', bytes: row.originalsBytes, className: 'bg-primary' },
                          {
                            key: 'Transcodes',
                            bytes: row.transcodesBytes,
                            className: 'bg-secondary-fixed',
                          },
                          {
                            key: 'Thumbnails',
                            bytes: row.thumbnailsBytes,
                            className: 'bg-tertiary-fixed-dim',
                          },
                        ]}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-outline">No stored files yet.</p>
              )}
            </AdminSection>
          </div>
        </div>
      ) : null}
    </AdminSection>
  );
}
