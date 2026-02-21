"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import AppSidebar from "../components/app-sidebar";
import { listAlbums, formatApiError } from "../../lib/api";
import { Spinner } from "../timeline/components/Spinner";
import { useRequireSession } from "../shared/hooks/useRequireSession";
import { AlbumThumbnail } from "./components/AlbumThumbnail";
import { CreateAlbumModal } from "./components/CreateAlbumModal";

export default function AlbumsPage() {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { meQuery, user } = useRequireSession({ redirectPath: "/albums" });

  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () => listAlbums(),
    enabled: meQuery.isSuccess
  });

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
      <AppSidebar activeLabel="Albums" isAdmin={Boolean(user?.isAdmin)} />

      <main className="flex-1 overflow-y-auto relative scroll-smooth px-6 sm:px-12 pb-20 pt-10 bg-background-light dark:bg-background-dark">
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    router.push(`/albums/${album.id}`);
                  }
                }}
              >
                <div className="w-full flex-1 rounded-xl overflow-hidden mb-3 relative flex items-center justify-center bg-slate-100 dark:bg-card-dark text-slate-300">
                  <AlbumThumbnail sampleMediaIds={album.sampleMediaIds} />
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
