import { useCallback, useState } from 'react';
import type { Asset } from '@photox/shared-types';
import { FaFolderPlus, FaImage, FaTrash } from 'react-icons/fa6';
import { AppShell } from '../components/AppShell';
import { useConfirm } from '../components/ConfirmProvider';
import { EmptyState, LoadingState } from '../components/StateViews';
import { useAssetNavigation } from '../hooks/useAssetNavigation';
import { useTimelineView } from '../hooks/useTimelineView';
import { TimelineAssets } from '../components/Timeline/TimelineAssets';
import { TimelineError, TimelineViewer } from '../components/Timeline/TimelinePage';
import { DropZone } from '../components/DropZone';
import { UploadButton } from '../components/UploadButton';
import { trashAssets } from '../api/assets';
import { toggleId } from '../lib/set';
import { useAppStore } from '../store/app-store';

function TimelineContent() {
  const confirm = useConfirm();
  // Structure (buckets, heights, order) comes from the layout endpoint; months fill it in.
  const view = useTimelineView();
  const { timeline, loadedAssets, navHelpers } = view;
  const bumpTimelineRefresh = useAppStore((s) => s.bumpTimelineRefresh);

  // One refresh signal: layout refetches itself, months re-check their stamps and the grid
  // re-triggers ensureMonth for whatever is on screen (uploads bump this too, via lib/upload).
  const refresh = bumpTimelineRefresh;

  const nav = useAssetNavigation({
    assets: loadedAssets,
    ...navHelpers,
    onAfterAction: refresh,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => toggleId(prev, id));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkTrash = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !(await confirm({
        title: `Move ${ids.length} item${ids.length > 1 ? 's' : ''} to trash?`,
        destructive: true,
      }))
    )
      return;
    try {
      await trashAssets(ids);
      clearSelection();
      refresh();
    } catch {
      window.alert('Failed to move items to trash. Please try again.');
    }
  };

  // stable handler identities: memoized GalleryItems must bail out on unrelated re-renders
  const selectionMode = selectedIds.size > 0;
  const selectionBarVisible = selectedIds.size > 0 && !pickerOpen;
  const onClickAsset = useCallback(
    (asset: Asset) => {
      if (selectionMode) toggle(asset.id);
      else nav.open(asset);
    },
    [selectionMode, toggle, nav.open],
  );

  const onLongPress = useCallback((asset: Asset) => {
    setSelectedIds((prev) => new Set(prev).add(asset.id));
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10);
  }, []);

  // Gate: layout drives structure. ponytail: a layout failure (first load OR refresh) lands on
  // the error state — no partial-track fallback, since every height depends on it; Reload retries.
  if (timeline.error) return <TimelineError message={timeline.error} />;

  if (timeline.loading) return <LoadingState />;

  if (timeline.layout.buckets.length === 0)
    return (
      <EmptyState
        icon={<FaImage className="text-4xl text-primary" />}
        circleClassName="bg-primary/10 ring-1 ring-primary/25"
        title="No memories yet"
        body="Your timeline is currently empty. Start preserving your life's moments by uploading your first batch of photos."
      >
        <UploadButton />
      </EmptyState>
    );

  return (
    <>
      <DropZone className="h-full">
        {/* fixed overlay — inside DropZone so file drops onto the strip still reach its handlers */}
        <TimelineAssets
          view={view}
          rememberScroll
          onSelect={onClickAsset}
          selectedIds={selectedIds}
          onToggleSelect={toggle}
          onLongPress={onLongPress}
        />
      </DropZone>
      <TimelineViewer
        nav={nav}
        onTrash={() => {
          void nav.trash();
        }}
        onToggleFavorite={(nextValue) => void nav.toggleSelectedFavorite(nextValue)}
        onAddToAlbum={() => {
          const cur = nav.selected;
          if (cur) {
            setSelectedIds((prev) => new Set(prev).add(cur.id));
            setPickerOpen(true);
          }
        }}
        siblingAssets={loadedAssets}
        onSelectSibling={(asset) => nav.open(asset)}
        pickerOpen={selectedIds.size > 0 && pickerOpen}
        onPickerClose={() => {
          setPickerOpen(false);
          clearSelection();
        }}
        pickerAssetIds={Array.from(selectedIds)}
        onPickerDone={clearSelection}
      />
      <div
        // inert, not aria-hidden: aria-hidden on an ancestor that still holds focus (bar button
        // clicked) is refused by Chrome, and slid-out buttons would stay tabbable. React 19 types
        // `inert` as a boolean, so it spreads instead of being passed through as a string attr.
        // data-selection-bar lifts the upload toast above the bar (see app.css) so the two
        // bottom-anchored overlays never intercept each other's clicks.
        {...(selectionBarVisible ? { 'data-selection-bar': 'visible' } : { inert: true })}
        className={`fixed bottom-0 left-0 right-0 z-40 bg-card-dark/95 backdrop-blur border-t border-border-dark px-4 py-3 flex items-center gap-3 transition-transform duration-300 ease-out ${
          selectionBarVisible ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <span className="text-sm text-slate-300 font-medium shrink-0 truncate">
          {selectedIds.size} selected
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={clearSelection}
          className="text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5 shrink-0"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void handleBulkTrash();
          }}
          className="text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          <FaTrash className="text-xs" />
          Trash
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          <FaFolderPlus className="text-xs" />
          Add to album
        </button>
      </div>
    </>
  );
}

export default function TimelineRoute() {
  return (
    <AppShell>
      <TimelineContent />
    </AppShell>
  );
}
