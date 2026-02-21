export function TimelineSelectionActionBar({ selectedCount, onClear, onAddToAlbum }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6 py-4 bg-slate-900/95 backdrop-blur-md border-t border-white/10 shadow-2xl">
      <span className="text-white font-semibold text-sm">{selectedCount} selected</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="text-slate-400 hover:text-white text-sm transition-colors"
          onClick={onClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-5 py-2 rounded-full transition-all shadow-lg"
          onClick={onAddToAlbum}
        >
          <span className="material-symbols-outlined text-[18px]">photo_library</span>
          Add to Album
        </button>
      </div>
    </div>
  );
}
