"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";

import AppSidebar from "../../components/app-sidebar";
import { getAlbumById, listAlbumItems, removeMediaFromAlbum, formatApiError } from "../../../lib/api";
import { Spinner } from "../../timeline/components/Spinner";
import { TimelineLightbox } from "../../timeline/components/TimelineLightbox";
import { AlbumMediaTile } from "../components/AlbumMediaTile";
import { useRequireSession } from "../../shared/hooks/useRequireSession";

export default function AlbumDetailPage() {
  const params = useParams();
  const albumId = params.id;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const urlMediaId = searchParams.get("mediaId");
  const activeMediaId = urlMediaId;

  const { meQuery, user } = useRequireSession({ redirectPath: `/albums/${albumId}` });

  const albumQuery = useQuery({
    queryKey: ["album", albumId],
    queryFn: () => getAlbumById(albumId),
    enabled: meQuery.isSuccess
  });

  const itemsQuery = useQuery({
    queryKey: ["album-items", albumId],
    queryFn: () => listAlbumItems(albumId),
    enabled: meQuery.isSuccess
  });

  const removeMutation = useMutation({
    mutationFn: (mediaId) => removeMediaFromAlbum(albumId, mediaId),
    onSuccess: (_, mediaId) => {
      queryClient.setQueryData(["album-items", albumId], (old) => {
        if (!old) {
          return old;
        }
        return { ...old, items: old.items.filter((i) => i.mediaId !== mediaId) };
      });
      queryClient.invalidateQueries({ queryKey: ["album", albumId] });
      queryClient.invalidateQueries({ queryKey: ["albums"] });
    }
  });

  const updateMediaId = useCallback((mediaId) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (mediaId) {
      nextParams.set("mediaId", mediaId);
    } else {
      nextParams.delete("mediaId");
    }
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!activeMediaId) {
      return;
    }
    const onKey = (e) => {
      if (e.key === "Escape") {
        updateMediaId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeMediaId, updateMediaId]);

  useEffect(() => {
    if (!activeMediaId) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [activeMediaId]);

  const album = albumQuery.data;
  const rawItems = itemsQuery.data?.items || [];

  // Normalize items for TimelineLightbox (aliasing mediaId to id)
  const items = useMemo(() => {
    return rawItems.map(item => ({
      ...item,
      id: item.mediaId
    }));
  }, [rawItems]);

  const activeIndex = useMemo(() => {
    if (!activeMediaId) return -1;
    return items.findIndex(i => i.id === activeMediaId);
  }, [activeMediaId, items]);

  const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex >= 0 && activeIndex < items.length - 1;

  const handlePrevious = useCallback(() => {
    if (canGoPrev) {
      updateMediaId(items[activeIndex - 1].id);
    }
  }, [activeIndex, canGoPrev, items, updateMediaId]);

  const handleNext = useCallback(() => {
    if (canGoNext) {
      updateMediaId(items[activeIndex + 1].id);
    }
  }, [activeIndex, canGoNext, items, updateMediaId]);

  const filmstripItems = useMemo(() => {
    if (activeIndex < 0) return [];
    const start = Math.max(0, activeIndex - 3);
    const end = Math.min(items.length, activeIndex + 4);
    return items.slice(start, end);
  }, [activeIndex, items]);

  if (meQuery.isPending || meQuery.isError) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background-light dark:bg-background-dark">
        <Spinner size="lg" label="Validating session..." />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
      <AppSidebar activeLabel="Albums" isAdmin={Boolean(user?.isAdmin)} />

      <main className="flex-1 overflow-y-auto relative scroll-smooth px-4 sm:px-8 pb-20 pt-6">
        <div className="mx-auto max-w-6xl mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Link
              href="/albums"
              className="flex items-center gap-1 text-slate-500 hover:text-primary text-sm font-medium transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Albums
            </Link>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              {albumQuery.isPending ? (
                <div className="h-9 w-48 rounded-lg bg-slate-200 dark:bg-card-dark animate-pulse" />
              ) : albumQuery.isError ? (
                <p className="text-red-500 text-sm">{formatApiError(albumQuery.error)}</p>
              ) : (
                <>
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{album?.title}</h1>
                  <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
                    {album?.mediaCount ?? items.length} media item{(album?.mediaCount ?? items.length) !== 1 ? "s" : ""}
                    {album?.createdAt ? ` · Created ${new Date(album.createdAt).toLocaleDateString()}` : ""}
                  </p>
                </>
              )}
            </div>

            <Link
              href="/timeline"
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-all shadow-lg"
            >
              <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
              Add Photos
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-6xl">
          {itemsQuery.isPending && (
            <div className="flex justify-center py-16">
              <Spinner label="Loading media..." />
            </div>
          )}

          {itemsQuery.isError && (
            <p className="text-red-500 text-sm text-center py-10">{formatApiError(itemsQuery.error)}</p>
          )}

          {itemsQuery.isSuccess && items.length === 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-12 text-center">
              <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600">photo_library</span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">Album is empty</h3>
              <p className="mt-2 text-sm text-slate-500">Go to Timeline, select media and click &ldquo;Add to Album&rdquo;.</p>
              <Link
                href="/timeline"
                className="mt-6 inline-flex items-center gap-2 bg-primary text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                Go to Timeline
              </Link>
            </div>
          )}

          {itemsQuery.isSuccess && items.length > 0 && (
            <div className="masonry-grid">
              {items.map((item) => (
                <AlbumMediaTile
                  key={item.id}
                  mediaId={item.id}
                  mimeType={item.mimeType}
                  onOpen={() => updateMediaId(item.id)}
                  onRemove={() => removeMutation.mutate(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {activeMediaId ? (
        <TimelineLightbox
          activeMediaId={activeMediaId}
          activeItem={activeItem}
          activeMetadataPreview={activeItem?.metadataPreview}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          isFetchingNextPage={false}
          filmstripItems={filmstripItems}
          modalError=""
          onClose={() => updateMediaId(null)}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onSelectFilmstrip={(id) => updateMediaId(id)}
        />
      ) : null}
    </div>
  );
}
