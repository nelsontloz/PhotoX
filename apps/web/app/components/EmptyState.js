import Link from "next/link";
import { Spinner } from "./Spinner";

/**
 * Reusable "nothing here yet" empty state card.
 *
 * Props:
 *  - icon: string — material symbol name (e.g. "photo_library")
 *  - title: string
 *  - description: string
 *  - cta: { label, href, icon? } — optional call-to-action link
 *  - className: string — extra wrapper classes
 */
export function EmptyState({ icon, title, description, cta, className = "" }) {
    return (
        <div className={`rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-12 text-center ${className}`}>
            {icon && (
                <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600">{icon}</span>
            )}
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">{title}</h3>
            {description && (
                <p className="mt-2 text-sm text-slate-500">{description}</p>
            )}
            {cta && (
                <Link
                    href={cta.href}
                    className="mt-6 inline-flex items-center gap-2 bg-primary text-white text-sm font-semibold px-6 py-2 rounded-lg transition-all"
                >
                    {cta.icon && <span className="material-symbols-outlined text-[18px]">{cta.icon}</span>}
                    {cta.label}
                </Link>
            )}
        </div>
    );
}

/**
 * Centered loading state (for within-page data fetching).
 *
 * Props:
 *  - label: string
 *  - className: string
 */
export function LoadingCenter({ label = "", className = "" }) {
    return (
        <div className={`flex justify-center py-16 ${className}`}>
            <Spinner label={label} />
        </div>
    );
}
