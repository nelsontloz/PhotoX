export function Spinner({ label = "Loading...", size = "md", className = "" }) {
    const sizeClass = size === "sm" ? "h-5 w-5 border-2" : "h-10 w-10 border-4";
    return (
        <div className={`flex flex-col items-center justify-center gap-2 text-slate-600 ${className}`}>
            <span className={`inline-block animate-spin rounded-full border-slate-300 border-t-cyan-500 ${sizeClass}`} aria-hidden="true" />
            <span className="text-xs font-medium" role="status" aria-live="polite">
                {label}
            </span>
        </div>
    );
}
