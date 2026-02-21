/**
 * Inline form error with a small error icon.
 *
 * Props:
 *  - message: string
 */
export function FormError({ message }) {
    if (!message) return null;
    return (
        <div className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 p-2 rounded border border-red-500/20">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{message}</span>
        </div>
    );
}
