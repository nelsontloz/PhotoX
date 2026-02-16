"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

function TimelineThumbnail({ mediaId }) {
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

  if (imageUrl) {
    return <img src={imageUrl} alt="Uploaded media" className="h-48 w-full rounded-xl object-cover" />;
  }

  if (loadError) {
    return (
      <div className="error min-h-48 rounded-xl text-xs">
        Could not load preview. {loadError}
      </div>
    );
  }

  return <div className="min-h-48 animate-pulse rounded-xl bg-[#d7e5eb]" />;
}

export default function TimelinePage() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);

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
                <TimelineThumbnail mediaId={item.id} />
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
    </main>
  );
}
