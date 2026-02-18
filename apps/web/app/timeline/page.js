"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchCurrentUser,
  fetchMediaContentBlob,
  fetchTimeline,
  formatApiError,
  isRetriableMediaProcessingError
} from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import AppSidebar from "../components/app-sidebar";

const TILE_ASPECTS = ["aspect-[4/3]", "aspect-square", "aspect-[3/4]", "aspect-square", "aspect-[4/3]"];
const MEDIA_POLL_INTERVAL_MS = 2000;
const MEDIA_POLL_MAX_ATTEMPTS = 15;

function Spinner({ label = "Loading...", size = "md", className = "" }) {
  const sizeClass = size === "sm" ? "h-5 w-5 border-2" : "h-10 w-10 border-4";
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-slate-600 ${className}`}>
      <span className={`inline-block animate-spin rounded-full border-slate-300 border-t-cyan-500 ${sizeClass}`} aria-hidden="true" />
      <span className="text-xs font-medium" role="status" aria-live="polite">
        {label}
      </span>
    </div>
  );
}

function isVideoMimeType(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("video/");
}

function formatTimelineDate(value) {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString();
}

function formatModalDate(value) {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatModalTime(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDurationSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return `${width}x${height}`;
}

function normalizeDayKey(value) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sectionLabel(dayKey) {
  if (dayKey === "unknown") {
    return {
      title: "Unknown date",
      subtitle: "No timestamp"
    };
  }

  const [year, month, day] = dayKey.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((todayStart.getTime() - date.getTime()) / 86400000);

  const subtitle = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });

  if (diffDays === 0) {
    return { title: "Today", subtitle };
  }

  if (diffDays === 1) {
    return { title: "Yesterday", subtitle };
  }

  return {
    title: date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric"
    }),
    subtitle
  };
}

function TimelineThumbnail({ mediaId, onOpen, className = "" }) {
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");

  const thumbQuery = useQuery({
    queryKey: ["timeline-thumb", mediaId],
    queryFn: () => fetchMediaContentBlob(mediaId, "thumb"),
    staleTime: 5 * 60 * 1000
  });

  useEffect(() => {
    if (!thumbQuery.data) {
      return;
    }

    const nextUrl = URL.createObjectURL(thumbQuery.data);
    setImageUrl(nextUrl);
    setLoadError("");

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [thumbQuery.data]);

  useEffect(() => {
    if (thumbQuery.isError) {
      setLoadError(formatApiError(thumbQuery.error));
    }
  }, [thumbQuery.error, thumbQuery.isError]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative w-full overflow-hidden rounded-lg bg-slate-200 text-left shadow-sm transition-all hover:shadow-md ${className}`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="Uploaded media" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      ) : loadError ? (
        <div className="flex h-full min-h-[180px] items-center justify-center p-4 text-xs text-red-600">{loadError}</div>
      ) : (
        <div className="flex h-full min-h-[180px] items-center justify-center bg-slate-100">
          <Spinner label="Generating thumbnail..." size="sm" className="text-slate-500" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
      <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="rounded-full bg-white/90 px-2 py-1 text-xs font-semibold text-slate-700">Open</span>
      </div>
    </button>
  );
}

function TimelineModalMedia({ mediaId, mimeType }) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const isVideo = isVideoMimeType(mimeType);
  const variant = isVideo ? "playback" : "small";

  useEffect(() => {
    setMediaUrl("");
    setLoadError("");
    setRetryCount(0);
  }, [mediaId, variant]);

  const mediaQuery = useQuery({
    queryKey: ["timeline-modal-media", mediaId, variant],
    queryFn: () => fetchMediaContentBlob(mediaId, variant),
    enabled: Boolean(mediaId),
    staleTime: 5 * 60 * 1000
  });
  const { isError: isMediaError, error: mediaError, refetch: refetchMedia } = mediaQuery;

  useEffect(() => {
    if (!mediaQuery.data) {
      return;
    }

    const nextUrl = URL.createObjectURL(mediaQuery.data);
    setMediaUrl(nextUrl);
    setLoadError("");

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [mediaQuery.data]);

  useEffect(() => {
    if (isMediaError) {
      if (isRetriableMediaProcessingError(mediaError) && retryCount < MEDIA_POLL_MAX_ATTEMPTS) {
        const timeoutId = window.setTimeout(() => {
          setRetryCount((count) => count + 1);
          refetchMedia();
        }, MEDIA_POLL_INTERVAL_MS);

        return () => {
          window.clearTimeout(timeoutId);
        };
      }

      setLoadError(formatApiError(mediaError));
    }
  }, [isMediaError, mediaError, refetchMedia, retryCount]);

  if (mediaUrl) {
    if (isVideo) {
      return (
        <video
          src={mediaUrl}
          controls
          playsInline
          preload="metadata"
          className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain"
          onError={() => setLoadError("Video playback failed (MEDIA_PLAYBACK_ERROR)")}
        />
      );
    }

    return <img src={mediaUrl} alt="Selected media" className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain" />;
  }

  if (loadError) {
    return <div className="error w-full">Could not load media. {loadError}</div>;
  }

  return (
    <div className="flex h-[60vh] w-full items-center justify-center rounded-xl bg-[#d7e5eb]">
      <Spinner
        label={isVideo ? "Preparing video playback..." : "Preparing full preview..."}
        size="md"
        className="text-slate-700"
      />
    </div>
  );
}

function FilmstripThumb({ mediaId, isActive, onSelect }) {
  const [thumbUrl, setThumbUrl] = useState("");

  const thumbQuery = useQuery({
    queryKey: ["timeline-thumb", mediaId],
    queryFn: () => fetchMediaContentBlob(mediaId, "thumb"),
    staleTime: 5 * 60 * 1000
  });

  useEffect(() => {
    if (!thumbQuery.data) {
      return;
    }

    const nextUrl = URL.createObjectURL(thumbQuery.data);
    setThumbUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [thumbQuery.data]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        isActive
          ? "relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 ring-cyan-400 ring-offset-2 ring-offset-black"
          : "relative h-12 w-16 shrink-0 overflow-hidden rounded opacity-60 transition-all hover:scale-105 hover:opacity-100"
      }
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt="Filmstrip thumbnail" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-slate-600" />
      )}
    </button>
  );
}

export default function TimelinePage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMediaId, setActiveMediaId] = useState(null);
  const [modalError, setModalError] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
      <main className="shell py-10">
        <section className="panel p-8">
          <p className="text-sm text-ocean-700">Validating session...</p>
        </section>
      </main>
    );
  }

  if (meQuery.isError) {
    return null;
  }

  return (
    <div className="relative flex h-[calc(100vh-61px)] overflow-hidden bg-[#f6f8f8] text-slate-900">
      <style jsx global>{`
        .timeline-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .timeline-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .timeline-scroll::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .timeline-scroll::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>

      {isSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-[61px] left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform duration-300 lg:static lg:inset-auto lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AppSidebar activeLabel="Timeline" isAdmin={Boolean(meQuery.data?.user?.isAdmin)} />
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-10 border-b border-transparent bg-[#f6f8f8]/95 px-4 py-5 backdrop-blur lg:px-8">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-4">
            <button
              type="button"
              className="shrink-0 rounded-full p-2 transition-colors hover:bg-slate-100 lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
            >
              Menu
            </button>

            <div className="group relative flex-1">
              <input
                className="block w-full rounded-full border border-slate-200 bg-white py-3 pl-4 pr-12 text-sm shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                placeholder="Search your memories (e.g., 'Beach 2023', 'Cats')..."
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-xs font-semibold text-slate-400">
                Search
              </span>
            </div>
          </div>

          <div className="mx-auto mt-4 flex w-full max-w-3xl gap-3 overflow-x-auto pb-1">
            <button className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-cyan-500 hover:text-cyan-600">
              People
            </button>
            <button className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-cyan-500 hover:text-cyan-600">
              Places
            </button>
            <button className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-cyan-500 hover:text-cyan-600">
              Things
            </button>
            <button className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-cyan-500 hover:text-cyan-600">
              Videos
            </button>
            <label className="ml-auto whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium shadow-sm">
              <input
                type="checkbox"
                className="mr-2 align-middle"
                checked={favoriteOnly}
                onChange={(event) => setFavoriteOnly(event.target.checked)}
              />
              Favorites
            </label>
          </div>

          <div className="mx-auto mt-3 grid w-full max-w-3xl gap-3 md:grid-cols-2">
            <input
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-cyan-500"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <input
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-cyan-500"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </header>

        <div className="timeline-scroll flex-1 overflow-y-auto px-4 pb-20 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-10 py-6">
            {timelineQuery.isError ? <p className="error">{formatApiError(timelineQuery.error)}</p> : null}
            {timelineQuery.isPending ? <p className="text-sm text-slate-600">Loading timeline...</p> : null}

            {!timelineQuery.isPending && sections.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700">
                No media yet. Upload photos and they will appear here.
              </div>
            ) : null}

            {sections.map((section) => (
              <section key={section.key}>
                <div className="sticky top-0 z-[1] mb-4 flex items-baseline gap-3 bg-[#f6f8f8] py-2">
                  <h2 className="text-xl font-bold text-slate-900">{section.title}</h2>
                  <span className="text-sm font-medium text-slate-500">{section.subtitle}</span>
                </div>

                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {section.items.map((item, index) => (
                    <div key={item.id} className={`group ${TILE_ASPECTS[index % TILE_ASPECTS.length]}`}>
                      <TimelineThumbnail
                        mediaId={item.id}
                        className="h-full"
                        onOpen={() => {
                          setModalError("");
                          setActiveMediaId(item.id);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {timelineQuery.hasNextPage ? (
              <button
                type="button"
                className="mx-auto rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-500 hover:text-cyan-600"
                disabled={timelineQuery.isFetchingNextPage}
                onClick={() => timelineQuery.fetchNextPage()}
              >
                {timelineQuery.isFetchingNextPage ? "Loading more..." : "Load more"}
              </button>
            ) : null}

            <div className="h-20" />
          </div>
        </div>

        <Link
          href="/upload"
          className="absolute bottom-8 right-8 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500 text-2xl font-bold text-white shadow-lg transition-all hover:scale-105 hover:bg-cyan-600"
          aria-label="Upload Photos"
        >
          +
        </Link>
      </main>

      {activeItem ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[#101d22]/95 text-white backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <header className="z-20 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-6 py-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                onClick={handleCloseModal}
              >
                Back
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
