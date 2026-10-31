import type { ComponentProps } from 'react'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { ErrorState } from '../StateViews'
import { ViewerHost } from '../ViewerHost'

// The two blocks every timeline-backed page repeats: the layout-failure gate (only a full reload
// re-runs the layout fetch) and ViewerHost pre-wired from useAssetNavigation.

export function TimelineError({ message }: { message: string }) {
  return <ErrorState message={message} onRetry={() => window.location.reload()} />
}

type TimelineViewerProps = Omit<
  ComponentProps<typeof ViewerHost>,
  'asset' | 'onClose' | 'onPrev' | 'onNext' | 'hasPrev' | 'hasNext'
> & {
  nav: ReturnType<typeof useAssetNavigation>
}

export function TimelineViewer({ nav, ...viewerProps }: TimelineViewerProps) {
  return (
    <ViewerHost
      asset={nav.selected}
      onClose={nav.close}
      onPrev={nav.goPrev}
      onNext={nav.goNext}
      hasPrev={nav.hasPrev}
      hasNext={nav.hasNext}
      {...viewerProps}
    />
  )
}
