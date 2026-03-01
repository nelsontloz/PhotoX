import Link from "next/link";

export function AdminHeader({
  workerStreamStatus,
  isCreateFormVisible,
  onToggleCreateForm,
  onRunOrphanSweep,
  isOrphanSweepPending
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-slate-500 w-full">
        <Link className="hover:text-primary transition-colors" href="/timeline">Home</Link>
        <span className="material-symbols-outlined text-base text-slate-400">chevron_right</span>
        <span className="text-slate-900 dark:text-white font-medium">Admin Console</span>
        <div className="ml-auto flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-100 dark:bg-background-dark border border-slate-200 dark:border-border-dark whitespace-nowrap">
          <span className={`size-1.5 rounded-full ${workerStreamStatus === "connected" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 animate-pulse"}`}></span>
          {workerStreamStatus === "connected" ? "Worker Online" : "Telemetry Delayed"}
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-end gap-4 pb-4 border-b border-slate-200 dark:border-border-dark">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 dark:text-white uppercase">Admin Console</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">System performance and user management overview.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRunOrphanSweep}
            disabled={isOrphanSweepPending}
            className="flex items-center gap-2 cursor-pointer justify-center overflow-hidden rounded-lg h-10 px-4 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors text-white text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-lg">delete</span>
            <span>{isOrphanSweepPending ? "Running..." : "Run Orphan Cleanup"}</span>
          </button>

          <button
            type="button"
            onClick={onToggleCreateForm}
            className="flex items-center gap-2 cursor-pointer justify-center overflow-hidden rounded-lg h-10 px-4 bg-primary hover:bg-primary/90 transition-colors text-white text-sm font-bold shadow-lg shadow-primary/20"
          >
            <span className="material-symbols-outlined text-lg">{isCreateFormVisible ? "close" : "add"}</span>
            <span>{isCreateFormVisible ? "Close" : "Add User"}</span>
          </button>
        </div>
      </div>
    </>
  );
}
