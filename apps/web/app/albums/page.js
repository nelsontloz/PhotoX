"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import AppSidebar from "../components/app-sidebar";
import { fetchCurrentUser, listAlbums, formatApiError } from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import { Spinner } from "../timeline/components/Spinner";

export default function AlbumsPage() {
  const router = useRouter();

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
        <section className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Featured</h2>
              <p className="text-slate-500 dark:text-slate-400 mt-1">Your most cherished memories</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 group relative h-[400px] rounded-2xl overflow-hidden cursor-pointer">
              <img
                alt="Summer Trip 2023"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAICJa25A8nWlO0Cx1ULd8yNg-LkoGDhsbhe3dybiakUIQyrz9hpNaE-2Ddd5B8DdQ4pirCUekuf3bvSLJh5fpz8goNRiOl_d2jJbnOhKaYmcQchkLRrRpj37kdohegFYRolgQ25lZIslATEGoSNQxbBNFa9413cmVv3bPmB6yNryxCGMMww_rRJha4CU362XXBD2-wvqbkmu0a9yKgqQomdl1PIsDLC8L_E7-yNv0rj2T7LCF9xA35fBM_j4yjw5h60PAnw9Ljn4w"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
              <div className="absolute bottom-0 left-0 p-8 w-full">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary text-sm filled" style={{ fontVariationSettings: '"FILL" 1' }}>star</span>
                  <span className="text-xs font-bold text-primary uppercase tracking-widest">Favorite</span>
                </div>
                <h3 className="text-3xl font-bold text-white mb-2">European Summer</h3>
                <div className="flex items-center gap-4 text-slate-300 text-sm">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">image</span> 342 photos
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">calendar_today</span> July 2023
                  </span>
                </div>
              </div>
            </div>
            <div className="group relative h-[400px] rounded-2xl overflow-hidden cursor-pointer">
              <img
                alt="Nature Retreat"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAH8mDgzWmv1SAB2UQmCP1SpT5YCju1cooHg_KvagWI5mA4EDBEKiFvO9zM_L_RSan8tdWeavxSG39VvhZsCB7hLxs7hujELsDAX9EzA5cpmD-kyf_jC_wIrlLNBrYevvDnEECD5B87htejaizf5feqz989HBLmRvOnPixS-rle3QKACGKGsiRzL3-wfh-RYlqrnWbMtlBNN_BgmAlGo3fHckuxTrWZ7P_Dzo0yV5zkfSInXL8afY0Pti4YDhMyP5ArMpvVs9arTCs"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
              <div className="absolute bottom-0 left-0 p-8 w-full">
                <h3 className="text-2xl font-bold text-white mb-2">Nature Retreat</h3>
                <div className="flex items-center gap-4 text-slate-300 text-sm">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">image</span> 128 photos
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">All Albums</h2>
            <div className="flex items-center gap-2">
              <button className="p-2 text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">grid_view</span>
              </button>
              <button className="p-2 text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined">list</span>
              </button>
            </div>
          </div>

          {albumsQuery.isError ? (
            <p className="text-red-500 mb-6">{formatApiError(albumsQuery.error)}</p>
          ) : null}

          {albumsQuery.isPending ? (
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">Loading albums...</p>
          ) : null}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            <div className="aspect-square group border-2 border-dashed border-slate-200 dark:border-border-dark hover:border-primary/50 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all bg-white/5 hover:bg-white/10">
              <div className="size-14 rounded-full bg-slate-100 dark:bg-card-dark flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:scale-110 transition-all">
                <span className="material-symbols-outlined text-[32px]">add</span>
              </div>
              <span className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Create Album</span>
            </div>

            {items.map((album) => (
              <div key={album.id} className="aspect-square group cursor-pointer flex flex-col" onClick={() => router.push(`/albums/${album.id}`)}>
                <div className="w-full h-full rounded-xl overflow-hidden mb-3 relative flex items-center justify-center bg-slate-200 dark:bg-card-dark text-slate-300">
                  <span className="material-symbols-outlined text-6xl opacity-50">photo_library</span>
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors"></div>
                  <div className="absolute top-2 right-2">
                    <div className="bg-black/50 backdrop-blur-md size-8 rounded-lg flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => {
                      e.stopPropagation();
                    }}>
                      <span className="material-symbols-outlined text-[18px]">more_vert</span>
                    </div>
                  </div>
                </div>
                <h4 className="font-semibold text-slate-900 dark:text-white truncate">{album.title}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(album.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
