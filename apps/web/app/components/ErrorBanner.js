/**
 * Page-level error banner (red, rounded card style).
 *
 * Props:
 *  - message: string
 *  - className: string
 */
export function ErrorBanner({ message, className = "" }) {
    if (!message) return null;
    return (
        <div className={`rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 p-4 text-sm text-red-600 dark:text-red-400 ${className}`}>
            {message}
        </div>
    );
}
