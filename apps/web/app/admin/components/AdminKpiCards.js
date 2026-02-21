export function AdminKpiCards({
  usersCount,
  activeUsersCount,
  activeAdminCount,
  totalStorageTb,
  storagePercent,
  workerBacklog,
  workerInFlight,
  workerStreamStatus
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 md:gap-6">
      <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-bold uppercase tracking-widest">Total Users</span>
          <span className="material-symbols-outlined text-lg">group</span>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-3xl font-black text-slate-900 dark:text-white">{usersCount.toLocaleString()}</span>
          <span className="rounded bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{activeUsersCount} Active</span>
        </div>
      </div>

      <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-bold uppercase tracking-widest">Active Admins</span>
          <span className="material-symbols-outlined text-lg">admin_panel_settings</span>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-3xl font-black text-slate-900 dark:text-white">{activeAdminCount}</span>
          <span className="rounded bg-cyan-50 dark:bg-primary/10 px-2 py-1 text-[10px] font-bold text-cyan-600 dark:text-primary">Privileged</span>
        </div>
      </div>

      <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-bold uppercase tracking-widest">Storage Used</span>
          <span className="material-symbols-outlined text-lg">database</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xl font-black text-slate-900 dark:text-white">{totalStorageTb.toFixed(2)}<span className="text-xs font-bold ml-1 text-slate-400">TB / 4TB</span></span>
          <span className="text-[10px] font-bold text-primary">{storagePercent}%</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
          <div className="bg-primary h-full transition-all duration-1000" style={{ width: `${storagePercent}%` }}></div>
        </div>
      </div>

      <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-bold uppercase tracking-widest">Worker Backlog</span>
          <span className="material-symbols-outlined text-lg">speed</span>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-3xl font-black text-slate-900 dark:text-white">{workerBacklog}</span>
          <span className="rounded bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-500">{workerInFlight} Active</span>
        </div>
      </div>

      <div className="p-6 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark flex flex-col justify-between h-32 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-bold uppercase tracking-widest">System Health</span>
          <span className={`material-symbols-outlined text-lg ${workerStreamStatus === "connected" ? "text-emerald-500" : "text-amber-500"}`}>
            {workerStreamStatus === "connected" ? "check_circle" : "warning"}
          </span>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-xl font-black text-slate-900 dark:text-white">
            {workerStreamStatus === "connected" ? "Operational" : "Degraded"}
          </span>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Telemetry: {workerStreamStatus}</p>
      </div>
    </div>
  );
}
