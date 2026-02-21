export function TimelineFiltersBar({
  favoriteOnly,
  onFavoriteChange,
  from,
  to,
  onFromChange,
  onToChange,
  selectionMode,
  onToggleSelectionMode
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
          People
        </button>
        <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
          Places
        </button>
        <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
          Things
        </button>
        <button className="whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm transition hover:border-primary hover:text-primary dark:text-slate-200">
          Videos
        </button>
        <label className="ml-auto inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark px-4 py-1.5 text-sm font-medium shadow-sm cursor-pointer dark:text-slate-200">
          <input
            type="checkbox"
            className="rounded text-primary focus:ring-primary h-4 w-4"
            checked={favoriteOnly}
            onChange={(event) => onFavoriteChange(event.target.checked)}
          />
          <span>Favorites</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="relative flex items-center">
          <span className="absolute left-3 text-slate-400 material-symbols-outlined text-[18px]">calendar_today</span>
          <input
            className="w-full rounded-lg border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark pl-10 pr-4 py-2 text-sm shadow-sm outline-none focus:border-primary dark:text-white"
            type="date"
            value={from}
            onChange={(event) => onFromChange(event.target.value)}
          />
          <span className="absolute -top-2 left-3 px-1 bg-background-light dark:bg-background-dark text-[10px] font-bold text-slate-400 uppercase tracking-wider">From</span>
        </div>
        <div className="relative flex items-center">
          <span className="absolute left-3 text-slate-400 material-symbols-outlined text-[18px]">event</span>
          <input
            className="w-full rounded-lg border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark pl-10 pr-4 py-2 text-sm shadow-sm outline-none focus:border-primary dark:text-white"
            type="date"
            value={to}
            onChange={(event) => onToChange(event.target.value)}
          />
          <span className="absolute -top-2 left-3 px-1 bg-background-light dark:bg-background-dark text-[10px] font-bold text-slate-400 uppercase tracking-wider">To</span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold border transition-all ${selectionMode
            ? "bg-primary border-primary text-white"
            : "border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark text-slate-700 dark:text-slate-200 hover:border-primary hover:text-primary"
            }`}
          onClick={onToggleSelectionMode}
        >
          <span className="material-symbols-outlined text-[16px]">
            {selectionMode ? "close" : "select_all"}
          </span>
          {selectionMode ? "Cancel Select" : "Select"}
        </button>
      </div>
    </div>
  );
}
