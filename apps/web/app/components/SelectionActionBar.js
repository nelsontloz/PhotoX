export function SelectionActionBar({ selectedCount, onClear, onAddToAlbum, onDelete }) {
    return (
        <div className="fixed bottom-0 left-[45px] sm:left-[72px] lg:left-60 right-0 z-50 flex items-center justify-between px-6 py-4 bg-slate-900/95 backdrop-blur-md border-t border-white/10 shadow-2xl transition-[left] duration-300">
            <span className="text-white font-semibold text-sm">{selectedCount} selected</span>
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    className="text-slate-400 hover:text-white text-sm transition-colors px-2"
                    onClick={onClear}
                >
                    Clear
                </button>

                <button
                    type="button"
                    className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-sm font-semibold px-4 py-2 rounded-full transition-all border border-red-500/20"
                    onClick={onDelete}
                    title="Delete selected"
                >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                    <span className="hidden sm:inline">Delete</span>
                </button>

                <button
                    type="button"
                    className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-full transition-all shadow-lg"
                    onClick={onAddToAlbum}
                    title="Add to Album"
                >
                    <span className="material-symbols-outlined text-[20px]">photo_library</span>
                    <span className="hidden sm:inline">Add to Album</span>
                </button>
            </div>
        </div>
    );
}
