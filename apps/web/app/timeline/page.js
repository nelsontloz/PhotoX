"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";

import {
  fetchCurrentUser,
  fetchMediaContentBlob,
  fetchTimeline,
  formatApiError
} from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import AppSidebar from "../components/app-sidebar";
import {
  formatModalDate,
  formatModalTime,
  formatDurationSeconds,
  formatDimensions,
  normalizeDayKey,
  sectionLabel,
  isVideoMimeType
} from "./utils";
import { Spinner } from "./components/Spinner";
import { TimelineThumbnail } from "./components/TimelineThumbnail";
import { TimelineModalMedia } from "./components/TimelineModalMedia";
import { FilmstripThumb } from "./components/FilmstripThumb";

function TimelineContent() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q") || "";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState(urlQ);

  useEffect(() => {
    setSearchQuery(urlQ);
  }, [urlQ]);
  const [activeMediaId, setActiveMediaId] = useState(null);
  const [modalError, setModalError] = useState("");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchCurrentUser(),
    retry: false
  });

  useEffect(() => {
    if (meQuery.isError) {
      router.replace(buildLoginPath("/timeline"));
    }
  }, [meQuery.isError, router]);

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
    if (!activeMediaId) {
      return;
    }

    if (activeIndex === -1) {
      setActiveMediaId(null);
      setModalError("");
    }
  }, [activeIndex, activeMediaId]);

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
    setActiveMediaId(null);
    setModalError("");
  }, []);

  const handlePreviousModal = useCallback(() => {
    if (activeIndex <= 0) {
      return;
    }

    setActiveMediaId(items[activeIndex - 1].id);
    setModalError("");
  }, [activeIndex, items]);

  const handleNextModal = useCallback(async () => {
    if (activeIndex < 0) {
      return;
    }

    setModalError("");
    const nextIndex = activeIndex + 1;

    if (nextIndex < items.length) {
      setActiveMediaId(items[nextIndex].id);
      return;
    }

    if (!timelineQuery.hasNextPage || timelineQuery.isFetchingNextPage) {
      return;
    }

    try {
      const result = await timelineQuery.fetchNextPage();
      const nextItems = (result.data?.pages || []).flatMap((page) => page.items || []);
      if (nextIndex < nextItems.length) {
        setActiveMediaId(nextItems[nextIndex].id);
      }
    } catch (error) {
      setModalError(formatApiError(error));
    }
  }, [activeIndex, items, timelineQuery]);

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
      <AppSidebar activeLabel="Timeline" isAdmin={Boolean(meQuery.data?.user?.isAdmin)} />

      <main className="flex-1 overflow-y-auto relative scroll-smooth px-4 sm:px-8 pb-20 pt-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
              People
            </button>
            <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
              Places
            </button>
            <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
              Things
            </button>
            <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
              Videos
            </button>
            <label className="ml-auto inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm cursor-pointer dark:text-slate-200">
              <input
                type="checkbox"
                className="rounded text-primary focus:ring-primary h-4 w-4"
                checked={favoriteOnly}
                onChange={(event) => setFavoriteOnly(event.target.checked)}
              />
              <span>Favorites</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative flex items-center">
              <span className="absolute left-3 text-slate-400 material-symbols-outlined text-[18px]">calendar_today</span>
              <input
                className="w-full rounded-lg border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark pl-10 pr-4 py-2 text-sm shadow-sm outline-none focus:border-primary dark:text-white"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <span className="absolute -top-2 left-3 px-1 bg-background-light dark:bg-background-dark text-[10px] font-bold text-slate-400 uppercase tracking-wider">From</span>
            </div>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-slate-400 material-symbols-outlined text-[18px]">event</span>
              <input
                className="w-full rounded-lg border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark pl-10 pr-4 py-2 text-sm shadow-sm outline-none focus:border-primary dark:text-white"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
              <span className="absolute -top-2 left-3 px-1 bg-background-light dark:bg-background-dark text-[10px] font-bold text-slate-400 uppercase tracking-wider">To</span>
            </div>
          </div>
        </div>

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

        {sections.map((section) => (
          <section key={section.key} className="mb-10">
            <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 transition-all">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{section.title}</h2>
              <span className="text-sm font-medium text-slate-500 mb-1">{section.subtitle}</span>
              <div className="ml-auto flex items-center">
                <button className="text-xs font-semibold text-primary hover:text-primary/80">Select all</button>
              </div>
            </div>

            <div className="masonry-grid">
              {section.items.map((item) => (
                <TimelineThumbnail
                  key={item.id}
                  item={item}
                  onOpen={() => {
                    setModalError("");
                    setActiveMediaId(item.id);
                  }}
                />
              ))}
            </div>
          </section>
        ))}

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

      {activeItem ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background-dark/95 text-white backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <header className="z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-6 py-6 transition-all duration-300">
            <div className="flex items-center gap-6">
              <button
                type="button"
                className="flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-semibold text-white transition-all backdrop-blur-sm"
                onClick={handleCloseModal}
              >
                <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                <span>Back</span>
              </button>
              <div>
                <h2 className="text-base font-bold tracking-tight">{formatModalDate(activeItem.takenAt || activeItem.uploadedAt)}</h2>
                <div className="flex items-center gap-2 text-xs font-medium text-white/60">
                  <span>{formatModalTime(activeItem.takenAt || activeItem.uploadedAt)}</span>
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  <span>{activeItem.mimeType || "image/jpeg"}</span>
                  {formatDimensions(activeMetadataPreview?.width, activeMetadataPreview?.height) ? (
                    <>
                      <span className="h-1 w-1 rounded-full bg-white/40" />
                      <span>{formatDimensions(activeMetadataPreview?.width, activeMetadataPreview?.height)}</span>
                    </>
                  ) : null}
                  {isVideoMimeType(activeItem.mimeType) && formatDurationSeconds(activeMetadataPreview?.durationSec) ? (
                    <>
                      <span className="h-1 w-1 rounded-full bg-white/40" />
                      <span>{formatDurationSeconds(activeMetadataPreview?.durationSec)}</span>
                    </>
                  ) : null}
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  <span>PhotoX Viewer</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-1 backdrop-blur-md">
                <button type="button" className="h-10 w-10 rounded-lg text-sm text-white/80 transition-all hover:bg-white/10 hover:text-cyan-300">
                  Share
                </button>
                <button type="button" className="h-10 w-10 rounded-lg text-sm text-cyan-300 transition-all hover:bg-white/10">
                  Fav
                </button>
                <button type="button" className="h-10 w-10 rounded-lg text-sm text-white/80 transition-all hover:bg-white/10 hover:text-cyan-300">
                  Info
                </button>
                <button type="button" className="h-10 w-10 rounded-lg text-sm text-white/80 transition-all hover:bg-white/10 hover:text-red-400">
                  Del
                </button>
              </div>
              <button
                type="button"
                className="h-10 w-10 rounded-full bg-white/10 text-white transition-all hover:bg-white/20"
                onClick={handleCloseModal}
              >
                X
              </button>
            </div>
          </header>

          <main className="group/main relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-24 pt-4 md:px-16">
            <button
              type="button"
              className="absolute left-4 z-10 rounded-full border border-white/10 bg-black/20 p-3 text-white opacity-0 transition-all duration-300 group-hover/main:translate-x-0 group-hover/main:opacity-100 hover:scale-110 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-20"
              onClick={handlePreviousModal}
              disabled={!canGoPrev}
            >
              {"<"}
            </button>

            <div className="relative flex max-h-full max-w-full items-center justify-center shadow-2xl">
              <TimelineModalMedia mediaId={activeItem.id} mimeType={activeItem.mimeType} />
            </div>

            <button
              type="button"
              className="absolute right-4 z-10 rounded-full border border-white/10 bg-black/20 p-3 text-white opacity-0 transition-all duration-300 group-hover/main:translate-x-0 group-hover/main:opacity-100 hover:scale-110 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-20"
              onClick={handleNextModal}
              disabled={!canGoNext || timelineQuery.isFetchingNextPage}
            >
              {">"}
            </button>
          </main>

          <div className="z-20 flex h-24 w-full flex-col justify-end bg-gradient-to-t from-black/90 to-transparent pb-4">
            <div className="flex w-full justify-center px-4">
              <div className="flex max-w-full gap-3 overflow-x-auto py-2">
                {filmstripItems.map((item) => (
                  <FilmstripThumb
                    key={item.id}
                    mediaId={item.id}
                    isActive={item.id === activeItem.id}
                    onSelect={() => {
                      setModalError("");
                      setActiveMediaId(item.id);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {modalError ? <p className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 rounded bg-red-900/70 px-3 py-1 text-xs">{modalError}</p> : null}
        </div>
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
