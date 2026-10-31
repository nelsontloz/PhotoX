import { useState } from 'react';
import { FaHeart } from 'react-icons/fa6';
import { RequireAuth } from '../../components/RequireAuth';
import { AppShell } from '../../components/AppShell';
import { TimelineAssets } from '../../components/Timeline/TimelineAssets';
import { TimelineError, TimelineViewer } from '../../components/Timeline/TimelinePage';
import { EmptyState, LoadingState } from '../../components/StateViews';
import { useAssetNavigation } from '../../hooks/useAssetNavigation';
import { useTimelineView } from '../../hooks/useTimelineView';
import { useAppStore } from '../../store/app-store';

function FavoritesContent() {
  // Same lazy pipeline as the home timeline, filtered to favorites (layout + per-month fetches).
  const view = useTimelineView({ favorite: true });
  const { timeline, loadedAssets, navHelpers } = view;
  const bumpTimelineRefresh = useAppStore((s) => s.bumpTimelineRefresh);
  const nav = useAssetNavigation({
    assets: loadedAssets,
    ...navHelpers,
    // un-favoriting in the viewer must refresh the filtered view
    onAfterAction: bumpTimelineRefresh,
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  if (timeline.loading) {
    return <LoadingState />;
  }

  if (timeline.error) {
    return <TimelineError message={timeline.error} />;
  }

  if (timeline.layout.buckets.length === 0) {
    return (
      <EmptyState
        icon={<FaHeart className="text-4xl text-red-500 dark:text-red-400" />}
        circleClassName="bg-red-500/10 dark:bg-red-500/15 ring-1 ring-red-500/25"
        title="No favorites yet"
        body="Photos you mark with a heart will appear here."
      />
    );
  }

  return (
    <>
      <TimelineAssets view={view} onSelect={nav.open} />
      <TimelineViewer
        nav={nav}
        onToggleFavorite={(nextValue) => {
          const cur = nav.selected;
          if (cur) void nav.toggleFavorite(cur.id, nextValue);
        }}
        onAddToAlbum={() => setPickerOpen(true)}
        siblingAssets={loadedAssets}
        onSelectSibling={(asset) => nav.open(asset)}
        pickerOpen={pickerOpen}
        onPickerClose={() => setPickerOpen(false)}
      />
    </>
  );
}

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <AppShell>
        <FavoritesContent />
      </AppShell>
    </RequireAuth>
  );
}
