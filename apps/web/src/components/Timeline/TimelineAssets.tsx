import type { Asset } from '@photox/shared-types'
import type { UseTimelineViewResult } from '../../hooks/useTimelineView'
import { TimelineGrid } from './TimelineGrid'

interface TimelineAssetsProps {
  /** A useTimelineView() result — the grid's layout/month props come from it */
  view: UseTimelineViewResult
  onSelect: (asset: Asset) => void
  /** Selection is optional: a read-only grid omits both (no checkboxes, no Select-all) */
  selectedIds?: ReadonlySet<string>
  onToggleSelect?: (id: string) => void
  onLongPress?: (asset: Asset) => void
  /** Surface classes of the sticky day-header bands (dialogs pass their panel surface) */
  dayHeaderSurfaceClassName?: string
}

/** TimelineGrid pre-wired from a useTimelineView() result — one grid call for every view. */
export function TimelineAssets({ view, ...gridProps }: TimelineAssetsProps) {
  return (
    <TimelineGrid
      layout={view.timeline.layout}
      containerRef={view.timeline.containerRef}
      groups={view.months.groups}
      monthStatus={view.months.monthStatus}
      ensureMonth={view.months.ensureMonth}
      retainMonths={view.months.retainMonths}
      {...gridProps}
    />
  )
}
