"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AppSidebar from "../components/app-sidebar";
import { fetchCurrentUser, listAlbums, createAlbum, formatApiError } from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import { Spinner } from "../timeline/components/Spinner";

function CreateAlbumModal({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => createAlbum({ title: title.trim() }),
    onSuccess: (album) => {
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      onCreated(album);
    },
    onError: (err) => setError(formatApiError(err))
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !createMutation.isPending) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">Create Album</h2>
          {!createMutation.isPending && (
            <button type="button" onClick={onClose} className="rounded-full p-1 text-white/60 hover:text-white hover:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          )}
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Album Title</label>
            <input
              type="text"
              autoFocus
              className="w-full rounded-lg bg-white/10 border border-white/10 focus:border-primary outline-none px-3 py-2.5 text-sm text-white placeholder-slate-500 transition-colors"
              placeholder="e.g. Summer Trip 2026"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) createMutation.mutate(); }}
              maxLength={1024}
              disabled={createMutation.isPending}
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-sm font-semibold py-2.5 transition-colors flex items-center justify-center gap-2"
              disabled={!title.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Spinner label="" size="sm" /> : null}
              Create
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 text-slate-400 hover:text-white text-sm px-4 py-2 transition-colors"
              onClick={onClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AlbumsPage() {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchCurrentUser(),
    retry: false
  });

  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () => listAlbums(),
    enabled: meQuery.isSuccess
  });

  useEffect(() => {
    if (meQuery.isError) {
      router.replace(buildLoginPath("/albums"));
    }
  }, [meQuery.isError, router]);

  if (meQuery.isPending || meQuery.isError) {
    return (
      <div className="flex h-[calc(100vh-64px)] w-full items-center justify-center bg-background-light dark:bg-background-dark">
        <Spinner size="lg" label="Validating session..." />
      </div>
    );
  }

  const items = albumsQuery.data?.items || [];

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
      <AppSidebar activeLabel="Albums" isAdmin={Boolean(meQuery.data?.user?.isAdmin)} />

      <main className="flex-1 overflow-y-auto relative scroll-smooth px-6 sm:px-12 pb-20 pt-10 bg-background-light dark:bg-background-dark">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Albums</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              {albumsQuery.isSuccess ? `${items.length} album${items.length !== 1 ? "s" : ""}` : "Your photo collections"}
            </p>
          </div>
          <button
            type="button"
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-all shadow-lg shadow-primary/20"
            onClick={() => setShowCreateModal(true)}
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Album
          </button>
        </div>

        {albumsQuery.isError && (
          <p className="text-red-500 mb-6 text-sm">{formatApiError(albumsQuery.error)}</p>
        )}

        {albumsQuery.isPending && (
          <div className="flex justify-center py-16">
            <Spinner label="Loading albums..." />
          </div>
        )}

        {albumsQuery.isSuccess && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {/* Create Album card */}
            <button
              type="button"
              className="aspect-square group border-2 border-dashed border-slate-200 dark:border-border-dark hover:border-primary/50 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all bg-white/5 hover:bg-white/10"
              onClick={() => setShowCreateModal(true)}
            >
              <div className="size-14 rounded-full bg-slate-100 dark:bg-card-dark flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:scale-110 transition-all">
                <span className="material-symbols-outlined text-[32px]">add</span>
              </div>
              <span className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Create Album</span>
            </button>

            {items.map((album) => (
              <div
                key={album.id}
                className="aspect-square group cursor-pointer flex flex-col"
                onClick={() => router.push(`/albums/${album.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") router.push(`/albums/${album.id}`); }}
              >
                <div className="w-full flex-1 rounded-xl overflow-hidden mb-3 relative flex items-center justify-center bg-slate-100 dark:bg-card-dark text-slate-300">
                  <span className="material-symbols-outlined text-6xl opacity-40">photo_library</span>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl" />
                  <div className="absolute bottom-2 right-2 bg-black/50 backdrop-blur-sm rounded-lg px-2 py-0.5 text-[10px] font-bold text-white">
                    {album.mediaCount ?? 0}
                  </div>
                </div>
                <h4 className="font-semibold text-slate-900 dark:text-white truncate text-sm">{album.title}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {album.mediaCount ?? 0} photo{(album.mediaCount ?? 0) !== 1 ? "s" : ""}
                </p>
              </div>
            ))}

            {items.length === 0 && (
              <div className="col-span-full text-center py-12 text-slate-500 dark:text-slate-400">
                <span className="material-symbols-outlined text-5xl opacity-30 mb-3 block">photo_library</span>
                <p className="text-sm">No albums yet. Create your first one!</p>
              </div>
            )}
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateAlbumModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(album) => {
            setShowCreateModal(false);
            router.push(`/albums/${album.id}`);
          }}
        />
      )}
    </div>
  );
}
