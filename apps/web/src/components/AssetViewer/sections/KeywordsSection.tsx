export function KeywordsSection() {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Keywords</h4>
      <div className="flex flex-wrap gap-1.5">
        {['Mountain', 'Sunset', 'Snow', 'Landscape', 'Sky', 'Outdoor'].map((kw) => (
          <span key={kw} className="text-[10px] bg-slate-800/50 text-slate-400 px-2 py-0.5 rounded">
            {kw}
          </span>
        ))}
      </div>
    </section>
  )
}
