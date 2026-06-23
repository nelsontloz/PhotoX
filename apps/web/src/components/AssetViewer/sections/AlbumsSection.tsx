export function AlbumsSection() {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Albums</h4>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-[11px] font-medium border border-border-dark">
          Japan 2023
          <button className="hover:text-white">
            <span className="text-[10px]">×</span>
          </button>
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-[11px] font-medium border border-border-dark">
          Nature
          <button className="hover:text-white">
            <span className="text-[10px]">×</span>
          </button>
        </span>
        <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-dashed border-slate-700 text-slate-500 text-[11px] font-medium hover:border-slate-500 hover:text-slate-300 transition-colors">
          <span className="text-[10px]">+</span>
          Add to album
        </button>
      </div>
    </section>
  )
}
