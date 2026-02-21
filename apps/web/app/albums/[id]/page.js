"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

import AppSidebar from "../../components/app-sidebar";
import { fetchCurrentUser, getAlbumById, listAlbumItems, fetchMediaContentBlob, removeMediaFromAlbum, formatApiError } from "../../../lib/api";
import { buildLoginPath } from "../../../lib/navigation";
import { Spinner } from "../../timeline/components/Spinner";
import { TimelineModalMedia } from "../../timeline/components/TimelineModalMedia";

function AlbumThumbnail({ mediaId, onOpen, onRemove }) {
    const [imageUrl, setImageUrl] = useState("");
    const [loadError, setLoadError] = useState("");

    const thumbQuery = useQuery({
        queryKey: ["timeline-thumb", mediaId],
        queryFn: () => fetchMediaContentBlob(mediaId, "thumb"),
        staleTime: 5 * 60 * 1000
    });

    useEffect(() => {
        if (!thumbQuery.data) return;
        const url = URL.createObjectURL(thumbQuery.data);
        setImageUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [thumbQuery.data]);

    useEffect(() => {
        if (thumbQuery.isError) setLoadError(formatApiError(thumbQuery.error));
    }, [thumbQuery.error, thumbQuery.isError]);

    return (
        <div className="masonry-item relative group rounded-lg overflow-hidden cursor-pointer bg-slate-200 dark:bg-card-dark">
            <div onClick={onOpen}>
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt="Album media"
                        className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                ) : loadError ? (
                    <div className="flex aspect-square items-center justify-center p-4 text-xs text-red-600">{loadError}</div>
                ) : (
                    <div className="flex aspect-square items-center justify-center">
                        <Spinner label="" size="sm" className="text-slate-500" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>

            {/* Remove button */}
            <button
                type="button"
                title="Remove from album"
                className="absolute top-2 right-2 size-7 rounded-full bg-black/60 hover:bg-red-600 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
            >
                <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
        </div>
    );
}

export default function AlbumDetailPage() {
    const router = useRouter();
    const params = useParams();
    const albumId = params.id;
    const queryClient = useQueryClient();

    const [activeMediaId, setActiveMediaId] = useState(null);

    const meQuery = useQuery({
        queryKey: ["me"],
        queryFn: () => fetchCurrentUser(),
        retry: false
    });

    useEffect(() => {
        if (meQuery.isError) router.replace(buildLoginPath(`/albums/${albumId}`));
    }, [meQuery.isError, router, albumId]);

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
                if (!old) return old;
                return { ...old, items: old.items.filter((i) => i.mediaId !== mediaId) };
            });
            queryClient.invalidateQueries({ queryKey: ["album", albumId] });
            queryClient.invalidateQueries({ queryKey: ["albums"] });
        }
    });

    // Keyboard close modal
    useEffect(() => {
        if (!activeMediaId) return;
        const onKey = (e) => { if (e.key === "Escape") setActiveMediaId(null); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [activeMediaId]);

    // Body scroll lock when modal open
    useEffect(() => {
        if (!activeMediaId) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prev; };
    }, [activeMediaId]);

    if (meQuery.isPending || meQuery.isError) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background-light dark:bg-background-dark">
                <Spinner size="lg" label="Validating session..." />
            </div>
        );
    }

    const album = albumQuery.data;
    const items = itemsQuery.data?.items || [];

    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
            <AppSidebar activeLabel="Albums" isAdmin={Boolean(meQuery.data?.user?.isAdmin)} />

            <main className="flex-1 overflow-y-auto relative scroll-smooth px-4 sm:px-8 pb-20 pt-6">
                {/* Header */}
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
                                        {album?.mediaCount ?? items.length} photo{(album?.mediaCount ?? items.length) !== 1 ? "s" : ""}
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

                {/* Content */}
                <div className="mx-auto max-w-6xl">
                    {itemsQuery.isPending && (
                        <div className="flex justify-center py-16">
                            <Spinner label="Loading photos..." />
                        </div>
                    )}

                    {itemsQuery.isError && (
                        <p className="text-red-500 text-sm text-center py-10">{formatApiError(itemsQuery.error)}</p>
                    )}

                    {itemsQuery.isSuccess && items.length === 0 && (
                        <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-12 text-center">
                            <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600">photo_library</span>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">Album is empty</h3>
                            <p className="mt-2 text-sm text-slate-500">Go to Timeline, select photos and click &ldquo;Add to Album&rdquo;.</p>
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
                                <AlbumThumbnail
                                    key={item.mediaId}
                                    mediaId={item.mediaId}
                                    onOpen={() => setActiveMediaId(item.mediaId)}
                                    onRemove={() => removeMutation.mutate(item.mediaId)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Modal viewer */}
            {activeMediaId ? (
                <div
                    className="fixed inset-0 z-50 flex flex-col bg-background-dark/95 text-white backdrop-blur-md"
                    role="dialog"
                    aria-modal="true"
                >
                    <header className="z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-6 py-6">
                        <button
                            type="button"
                            className="flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-semibold text-white transition-all backdrop-blur-sm"
                            onClick={() => setActiveMediaId(null)}
                        >
                            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                            <span>Back</span>
                        </button>
                    </header>

                    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-16 pt-4 md:px-16">
                        <div className="relative flex max-h-full max-w-full items-center justify-center shadow-2xl">
                            <TimelineModalMedia mediaId={activeMediaId} mimeType={items.find((i) => i.mediaId === activeMediaId)?.mimeType} />
                        </div>
                    </main>

                    <button
                        type="button"
                        className="absolute top-4 right-4 z-30 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all"
                        onClick={() => setActiveMediaId(null)}
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
            ) : null}
        </div>
    );
}
