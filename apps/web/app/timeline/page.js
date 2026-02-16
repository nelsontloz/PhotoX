"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchCurrentUser,
  fetchMediaContentBlob,
  fetchTimeline,
  formatApiError,
  logoutUser
} from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import { clearSession, readRefreshToken } from "../../lib/session";

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

function TimelineThumbnail({ mediaId, onOpen }) {
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
    <button type="button" className="w-full text-left" onClick={onOpen}>
      {imageUrl ? (
        <img src={imageUrl} alt="Uploaded media" className="h-48 w-full rounded-xl object-cover" />
      ) : loadError ? (
        <div className="error min-h-48 rounded-xl text-xs">Could not load preview. {loadError}</div>
      ) : (
        <div className="min-h-48 animate-pulse rounded-xl bg-[#d7e5eb]" />
      )}
    </button>
  );
}

function TimelineModalImage({ mediaId }) {
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setImageUrl("");
    setLoadError("");
  }, [mediaId]);

  const largeQuery = useQuery({
    queryKey: ["timeline-large", mediaId],
    queryFn: () => fetchMediaContentBlob(mediaId, "small"),
    enabled: Boolean(mediaId),
    staleTime: 5 * 60 * 1000
  });

  useEffect(() => {
    if (!largeQuery.data) {
      return;
    }

    const nextUrl = URL.createObjectURL(largeQuery.data);
    setImageUrl(nextUrl);
    setLoadError("");

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [largeQuery.data]);

  useEffect(() => {
    if (largeQuery.isError) {
      setLoadError(formatApiError(largeQuery.error));
    }
  }, [largeQuery.error, largeQuery.isError]);

  if (imageUrl) {
    return <img src={imageUrl} alt="Selected media" className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain" />;
  }

  if (loadError) {
    return <div className="error w-full">Could not load image. {loadError}</div>;
  }

  return <div className="h-[60vh] w-full animate-pulse rounded-xl bg-[#d7e5eb]" />;
}

export default function TimelinePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
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
    queryKey: ["timeline", from, to, favoriteOnly],
    queryFn: ({ pageParam }) =>
      fetchTimeline({
        cursor: pageParam || undefined,
        limit: 18,
        from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
        favorite: favoriteOnly ? true : undefined
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

  const activeIndex = useMemo(() => {
    if (!activeMediaId) {
      return -1;
    }

    return items.findIndex((item) => item.id === activeMediaId);
  }, [activeMediaId, items]);

  const activeItem = activeIndex >= 0 ? items[activeIndex] : null;

  const canGoPrev = activeIndex > 0;
  const canGoNext =
    activeIndex >= 0 && (activeIndex < items.length - 1 || (activeIndex === items.length - 1 && timelineQuery.hasNextPage));

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
      queryClient.prefetchQuery({
        queryKey: ["timeline-large", mediaId],
        queryFn: () => fetchMediaContentBlob(mediaId, "small"),
        staleTime: 5 * 60 * 1000
      });
    }
  }, [activeIndex, items, queryClient]);

  async function handleLogout() {
    const refreshToken = readRefreshToken();
    if (refreshToken) {
      try {
        await logoutUser(refreshToken);
      } catch (_err) {
        // local logout still proceeds
      }
    }

    clearSession();
    router.replace("/login");
  }

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
    <main className="shell py-10">
      <section className="panel space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ocean-900">Timeline</h1>
            <p className="mt-1 text-sm text-ocean-700">
              Signed in as <span className="font-semibold">{meQuery.data.user.email}</span>
            </p>
          </div>

          <button type="button" className="btn btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="block md:col-span-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ocean-800">From</span>
            <input
              className="field"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="block md:col-span-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ocean-800">To</span>
            <input className="field" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="flex items-end gap-2 text-sm font-semibold text-ocean-800 md:col-span-2">
            <input
              type="checkbox"
              checked={favoriteOnly}
              onChange={(event) => setFavoriteOnly(event.target.checked)}
            />
            Favorites only
          </label>
        </div>

        {timelineQuery.isError ? <p className="error">{formatApiError(timelineQuery.error)}</p> : null}

        {timelineQuery.isPending ? <p className="help">Loading timeline...</p> : null}

        {!timelineQuery.isPending && items.length === 0 ? (
          <div className="success">No media yet. Upload photos and they will appear here.</div>
        ) : null}

        {items.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-[#d6e5eb] bg-white p-3">
                <TimelineThumbnail
                  mediaId={item.id}
                  onOpen={() => {
                    setModalError("");
                    setActiveMediaId(item.id);
                  }}
                />
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ocean-700">
                    {item.flags.favorite ? "Favorite" : "Photo"}
                  </p>
                  <p className="text-sm font-semibold text-ocean-900">{formatTimelineDate(item.takenAt || item.uploadedAt)}</p>
                  <p className="help">mediaId={item.id}</p>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {timelineQuery.hasNextPage ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={timelineQuery.isFetchingNextPage}
            onClick={() => timelineQuery.fetchNextPage()}
          >
            {timelineQuery.isFetchingNextPage ? "Loading more..." : "Load more"}
          </button>
        ) : null}
      </section>

      {activeItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={handleCloseModal}
        >
          <div className="absolute inset-0 bg-[#0a1a24]/80 backdrop-blur-[2px]" />
          <div
            className="relative z-10 w-full max-w-5xl rounded-2xl border border-[#2a5166] bg-[#0f2431] p-4 text-white shadow-2xl md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm text-[#d2e6ef]">
                {activeIndex + 1} of {items.length} - {formatTimelineDate(activeItem.takenAt || activeItem.uploadedAt)}
              </p>
              <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>
                Close
              </button>
            </div>

            <div className="flex min-h-[62vh] items-center justify-center rounded-xl bg-[#0b1a24] p-2">
              <TimelineModalImage mediaId={activeItem.id} />
            </div>

            {modalError ? <p className="error mt-3">{modalError}</p> : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button type="button" className="btn btn-secondary" disabled={!canGoPrev} onClick={handlePreviousModal}>
                Previous
              </button>
              <p className="text-xs text-[#d2e6ef]">Use Left/Right arrows and Esc</p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canGoNext || timelineQuery.isFetchingNextPage}
                onClick={handleNextModal}
              >
                {timelineQuery.isFetchingNextPage && activeIndex === items.length - 1 ? "Loading..." : "Next"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
