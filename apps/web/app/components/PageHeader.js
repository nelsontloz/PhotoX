/**
 * Standard page header: title + subtitle on the left, optional action on the right.
 *
 * Props:
 *  - title: string
 *  - subtitle: string (optional)
 *  - action: ReactNode (optional) — right-side button/link
 *  - className: string
 */
export function PageHeader({ title, subtitle, action, className = "" }) {
    return (
        <div className={`flex items-end justify-between gap-4 ${className}`}>
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{title}</h1>
                {subtitle && (
                    <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">{subtitle}</p>
                )}
            </div>
            {action && <div>{action}</div>}
        </div>
    );
}
