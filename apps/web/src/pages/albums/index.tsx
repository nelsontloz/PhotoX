import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaCircleExclamation,
  FaEllipsisVertical,
  FaEye,
  FaEyeSlash,
  FaMagnifyingGlass,
  FaPhotoFilm,
  FaPlus,
  FaSpinner,
} from 'react-icons/fa6';
import { AppShell } from '../../components/AppShell';
import { AlbumCover } from '../../components/AlbumCover';
import { Dialog } from '../../components/Dialog';
import { NewAlbumFields } from '../../components/NewAlbumFields';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { useAsyncFetch } from '../../hooks/useAsyncFetch';
import { listAlbums, createAlbum, updateAlbum } from '../../api/albums';
import { useAppStore } from '../../store/app-store';
import type { AlbumDto } from '@photox/shared-types';

const EMPTY_ALBUMS: AlbumDto[] = [];

interface NewAlbumDialogProps {
  onClose: () => void;
  onCreate: (body: { name: string; description?: string }) => Promise<unknown>;
}

function NewAlbumDialog({ onClose, onCreate }: NewAlbumDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onClose();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create album');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="New Album"
      onClose={onClose}
      panelClassName="bg-card-dark rounded-xl shadow-2xl p-6 w-full max-w-md border border-border-dark"
      titleClassName="text-lg font-bold text-slate-100"
      closeClassName="text-slate-400 hover:text-slate-100 transition-colors disabled:opacity-40"
      closeDisabled={submitting}
      closeOnOverlay={false}
      escapeKey={false}
    >
      <NewAlbumFields
        name={name}
        onNameChange={setName}
        description={description}
        onDescriptionChange={setDescription}
      />

      {error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <FaCircleExclamation className="text-base mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-700/40 rounded-lg transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void submit();
          }}
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:bg-primary/40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20"
        >
          {submitting && <FaSpinner className="text-xs animate-spin" />}
          <span>Create</span>
        </button>
      </div>
    </Dialog>
  );
}

interface AlbumCardProps {
  album: AlbumDto;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
}

function AlbumCard({ album, menuOpen, onMenuOpenChange, onRefresh }: AlbumCardProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const bumpTimelineRefresh = useAppStore((s) => s.bumpTimelineRefresh);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onMenuOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMenuOpenChange(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, onMenuOpenChange]);

  const toggleTimelineVisibility = () => {
    onMenuOpenChange(false);
    void (async () => {
      try {
        await updateAlbum(album.id, { hiddenFromTimeline: !album.hiddenFromTimeline });
        await onRefresh();
        bumpTimelineRefresh();
      } catch {
        /* ponytail: silent fail, the card keeps its old state */
      }
    })();
  };

  return (
    <div data-album-card={album.id} className="relative group/card">
      <Link
        to={`/albums/${album.id}`}
        className="group/cover block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
      >
        <div className="aspect-square w-full rounded overflow-hidden bg-card-dark relative shadow-sm transition-shadow group-hover/cover:shadow-xl">
          <AlbumCover
            albumId={album.id}
            className="[&_img]:transition-transform [&_img]:duration-500 [&_img]:ease-out [&_img]:group-hover/cover:scale-110"
            emptyIconClassName="text-5xl text-slate-700"
          />
          <div className="absolute inset-0 bg-black/5 opacity-0 group-hover/cover:opacity-100 transition-opacity pointer-events-none" />
          {album.hiddenFromTimeline && (
            <div
              aria-label="Hidden from timeline"
              title="Hidden from timeline"
              className="absolute bottom-2 left-2 rounded-md bg-black/50 backdrop-blur-sm p-1.5 text-slate-300 pointer-events-none"
            >
              <FaEyeSlash className="text-xs" />
            </div>
          )}
        </div>
        <h3 className="font-bold text-slate-100 truncate mt-3">{album.name}</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          {album.assetCount} {album.assetCount === 1 ? 'item' : 'items'}
        </p>
      </Link>

      <div className="absolute right-2 top-2" ref={menuRef}>
        <button
          type="button"
          onClick={() => onMenuOpenChange(!menuOpen)}
          aria-label={`Options for ${album.name}`}
          aria-expanded={menuOpen}
          className="p-1.5 rounded-md bg-black/50 backdrop-blur-sm text-slate-300 hover:text-white transition opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <FaEllipsisVertical />
        </button>
        {/* z-50 clears the sticky page chrome; dialogs share z-50 and render later in the tree */}
        {menuOpen && (
          <div className="absolute right-0 mt-1 w-48 bg-card-dark border border-border-dark rounded-lg shadow-lg py-1 z-50">
            <button
              type="button"
              onClick={toggleTimelineVisibility}
              className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-white/5 inline-flex items-center gap-2"
            >
              {album.hiddenFromTimeline ? (
                <FaEye className="text-xs" />
              ) : (
                <FaEyeSlash className="text-xs" />
              )}
              {album.hiddenFromTimeline ? 'Show on timeline' : 'Hide from timeline'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AlbumsListContent() {
  const { data, loading, error, refresh } = useAsyncFetch(() => listAlbums({ limit: 1000 }), {
    errorMessage: 'Failed to load albums',
    loadingMode: 'always',
  });
  const albums = data?.items ?? EMPTY_ALBUMS;
  const total = data?.total ?? 0;
  const create = async (body: { name: string; description?: string }) => {
    const album = await createAlbum(body);
    await refresh();
    return album;
  };
  const [search, setSearch] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filtered = search.trim()
    ? albums.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()))
    : albums;

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Albums</h1>
          <p className="text-sm text-slate-500 mt-1">
            {total} {total === 1 ? 'album' : 'albums'} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search albums…"
              className="w-full bg-card-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20 shrink-0"
          >
            <FaPlus className="text-xs" />
            <span>New Album</span>
          </button>
        </div>
      </header>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
          <div className="mb-8 w-20 h-20 rounded-full bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/20 flex items-center justify-center">
            <FaPhotoFilm className="text-4xl text-primary" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
            No albums yet
          </h2>
          <p className="mt-4 text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed max-w-md">
            Group your photos into collections to keep things organized.
          </p>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="mt-8 inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors shadow-lg shadow-primary/20"
          >
            <FaPlus className="text-xs" />
            <span>New Album</span>
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <FaMagnifyingGlass className="text-3xl text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">No albums match "{search.trim()}".</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-8">
          {filtered.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              menuOpen={openMenuId === album.id}
              onMenuOpenChange={(open) => setOpenMenuId(open ? album.id : null)}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}

      {showNewDialog && (
        <NewAlbumDialog onClose={() => setShowNewDialog(false)} onCreate={create} />
      )}
    </div>
  );
}

export default function AlbumsPage() {
  return (
    <AppShell>
      <AlbumsListContent />
    </AppShell>
  );
}
