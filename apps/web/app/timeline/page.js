"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, Suspense, useRef } from "react";

import {
  fetchMediaContentBlob,
  fetchTimeline,
  formatApiError
} from "../../lib/api";
import AppSidebar from "../components/app-sidebar";
import {
  normalizeDayKey,
  sectionLabel,
  isVideoMimeType
} from "./utils";
import { Spinner } from "./components/Spinner";
import { AssignToAlbumModal } from "./components/AssignToAlbumModal";
import { TimelineFiltersBar } from "./components/TimelineFiltersBar";
import { TimelineSectionList } from "./components/TimelineSectionList";
import { TimelineSelectionActionBar } from "./components/TimelineSelectionActionBar";
import { MediaLightbox } from "../components/media/MediaLightbox";
import { useTimelineSelection } from "./hooks/useTimelineSelection";
import { useRequireSession } from "../shared/hooks/useRequireSession";

function TimelineContent() {
  const queryClient = useQueryClient();
  const { meQuery, user } = useRequireSession({ redirectPath: "/timeline" });

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q") || "";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState(urlQ);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const {
    selectionMode,
    selectedIds,
    toggleSelectionMode,
    selectItem,
    selectAllInSection,
    clearSelection,
    closeSelection
  } = useTimelineSelection();

  useEffect(() => {
    setSearchQuery(urlQ);
  }, [urlQ]);

  const urlMediaId = searchParams.get("mediaId");
  const activeMediaId = urlMediaId;
  const [modalError, setModalError] = useState("");

  const updateMediaId = useCallback((mediaId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (mediaId) {
      params.set("mediaId", mediaId);
    } else {
      params.delete("mediaId");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);


  const timelineQuery = useInfiniteQuery({
    queryKey: ["timeline", from, to, favoriteOnly, searchQuery],
    queryFn: ({ pageParam }) =>
      fetchTimeline({
        cursor: pageParam || undefined,
        limit: 18,
        from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
        favorite: favoriteOnly ? true : undefined,
        q: searchQuery.trim() || undefined
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: meQuery.isSuccess,
    initialPageParam: null
  });

  const items = useMemo(() => {
    if (!timelineQuery.data || !timelineQuery.data.pages) {
      return [];
    }

    return timelineQuery.data.pages.flatMap((page) => page.items || []);
  }, [timelineQuery.data]);

  const sections = useMemo(() => {
    const byDay = new Map();
    for (const item of items) {
      const key = normalizeDayKey(item.takenAt || item.uploadedAt);
      if (!byDay.has(key)) {
        byDay.set(key, []);
      }
      byDay.get(key).push(item);
    }

    return Array.from(byDay.entries())
      .sort((a, b) => {
        if (a[0] === "unknown") {
          return 1;
        }
        if (b[0] === "unknown") {
          return -1;
        }
        return a[0] < b[0] ? 1 : -1;
      })
      .map(([key, dayItems]) => ({ key, ...sectionLabel(key), items: dayItems }));
  }, [items]);

  const activeIndex = useMemo(() => {
    if (!activeMediaId) {
      return -1;
    }

    return items.findIndex((item) => item.id === activeMediaId);
  }, [activeMediaId, items]);

  const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
  const activeMetadataPreview = activeItem?.metadataPreview || null;
  const canGoPrev = activeIndex > 0;
  const canGoNext =
    activeIndex >= 0 && (activeIndex < items.length - 1 || (activeIndex === items.length - 1 && timelineQuery.hasNextPage));
  const filmstripItems = useMemo(() => {
    if (activeIndex < 0) {
      return [];
    }

    const start = Math.max(0, activeIndex - 3);
    const end = Math.min(items.length, activeIndex + 4);
    return items.slice(start, end);
  }, [activeIndex, items]);


  useEffect(() => {
    if (!activeItem) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeItem]);

  const handleCloseModal = useCallback(() => {
    updateMediaId(null);
    setModalError("");
  }, [updateMediaId]);

  const handlePreviousModal = useCallback(() => {
    if (activeIndex <= 0) {
      return;
    }

    updateMediaId(items[activeIndex - 1].id);
    setModalError("");
  }, [activeIndex, items, updateMediaId]);

  const handleNextModal = useCallback(async () => {
    if (activeIndex < 0) {
      return;
    }

    setModalError("");
    const nextIndex = activeIndex + 1;

    if (nextIndex < items.length) {
      updateMediaId(items[nextIndex].id);
      return;
    }

    if (!timelineQuery.hasNextPage || timelineQuery.isFetchingNextPage) {
      return;
    }

    try {
      const result = await timelineQuery.fetchNextPage();
      const nextItems = (result.data?.pages || []).flatMap((page) => page.items || []);
      if (nextIndex < nextItems.length) {
        updateMediaId(nextItems[nextIndex].id);
      }
    } catch (error) {
      setModalError(formatApiError(error));
    }
  }, [activeIndex, items, timelineQuery, updateMediaId]);

  useEffect(() => {
    if (!activeItem) {
      return;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseModal();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlePreviousModal();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNextModal();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeItem, handleCloseModal, handleNextModal, handlePreviousModal]);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }

    const neighborIds = [];
    if (activeIndex > 0) {
      neighborIds.push(items[activeIndex - 1].id);
    }
    if (activeIndex + 1 < items.length) {
      neighborIds.push(items[activeIndex + 1].id);
    }

    for (const mediaId of neighborIds) {
      const media = items.find((item) => item.id === mediaId);
      const variant = isVideoMimeType(media?.mimeType) ? "playback" : "small";
      queryClient.prefetchQuery({
        queryKey: ["timeline-modal-media", mediaId, variant],
        queryFn: () => fetchMediaContentBlob(mediaId, variant),
        staleTime: 5 * 60 * 1000
      });
    }
  }, [activeIndex, items, queryClient]);

  if (meQuery.isPending) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background-light dark:bg-background-dark">
        <Spinner size="lg" label="Validating session..." />
      </div>
    );
  }

  if (meQuery.isError) {
    return null;
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
      <AppSidebar activeLabel="Timeline" isAdmin={Boolean(user?.isAdmin)} />

      <main className="flex-1 overflow-y-auto relative scroll-smooth px-4 sm:px-8 pb-20 pt-6">
        <TimelineFiltersBar
          favoriteOnly={favoriteOnly}
          onFavoriteChange={setFavoriteOnly}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          selectionMode={selectionMode}
          onToggleSelectionMode={toggleSelectionMode}
        />

        {timelineQuery.isError ? <p className="error mb-6">{formatApiError(timelineQuery.error)}</p> : null}
        {timelineQuery.isPending ? <p className="text-sm text-slate-600 dark:text-slate-400">Loading timeline...</p> : null}

        {!timelineQuery.isPending && sections.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-8 text-center">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">No media yet</h3>
            <p className="mt-2 text-sm text-slate-500">Upload photos and they will appear here.</p>
            <Link
              href="/upload"
              className="mt-6 inline-flex items-center gap-2 bg-primary text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span>
              <span>Upload Photos</span>
            </Link>
          </div>
        ) : null}

        <TimelineSectionList
          sections={sections}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onSelectItem={selectItem}
          onSelectAllSection={selectAllInSection}
          onOpenItem={(mediaId) => {
            setModalError("");
            updateMediaId(mediaId);
          }}
        />

        {timelineQuery.hasNextPage ? (
          <div className="flex justify-center mt-10">
            <button
              type="button"
              className="flex items-center gap-2 bg-white dark:bg-card-dark border border-slate-200 dark:border-border-dark px-6 py-2 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-200 transition-all hover:bg-slate-50 dark:hover:bg-gray-800 disabled:opacity-50"
              disabled={timelineQuery.isFetchingNextPage}
              onClick={() => timelineQuery.fetchNextPage()}
            >
              {timelineQuery.isFetchingNextPage ? (
                <Spinner label="" size="sm" />
              ) : (
                <span>Load more...</span>
              )}
            </button>
          </div>
        ) : null}

        <Link
          href="/upload"
          className="fixed bottom-8 right-8 z-50 flex items-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold px-6 py-3 rounded-full transition-all shadow-xl shadow-primary/20 sm:hidden"
          aria-label="Upload Photos"
        >
          <span className="material-symbols-outlined">upload</span>
          <span>Upload</span>
        </Link>
      </main>

      {selectionMode && selectedIds.size > 0 && (
        <TimelineSelectionActionBar
          selectedCount={selectedIds.size}
          onClear={clearSelection}
          onAddToAlbum={() => setShowAssignModal(true)}
        />
      )}

      {showAssignModal && (
        <AssignToAlbumModal
          selectedIds={selectedIds}
          onClose={() => setShowAssignModal(false)}
          onSuccess={() => {
            setShowAssignModal(false);
            closeSelection();
          }}
        />
      )}

      {activeMediaId ? (
        <MediaLightbox
          activeMediaId={activeMediaId}
          activeItem={activeItem}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          isFetchingNextPage={timelineQuery.isFetchingNextPage}
          filmstripItems={filmstripItems}
          modalError={modalError}
          onClose={handleCloseModal}
          onPrevious={handlePreviousModal}
          onNext={handleNextModal}
          onSelectFilmstrip={(id) => updateMediaId(id)}
        />
      ) : null}
    </div>
  );
}

export default function TimelinePage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-full items-center justify-center bg-background-light dark:bg-background-dark">
        <Spinner size="lg" />
      </div>
    }>
      <TimelineContent />
    </Suspense>
  );
}
