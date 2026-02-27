"use client";

import { useEffect } from "react";

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    variant = "danger",
    isPending = false
}) {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const variantStyles = {
        danger: "bg-red-500 hover:bg-red-600 text-white",
        primary: "bg-primary hover:bg-primary/90 text-white"
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={handleBackdropClick}
        >
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                        {title}
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400">
                        {message}
                    </p>
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-white/5">
                    <button
                        type="button"
                        className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        onClick={onClose}
                        disabled={isPending}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={`flex items-center gap-2 px-6 py-2 rounded-full text-sm font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:pointer-events-none ${variantStyles[variant]}`}
                        onClick={onConfirm}
                        disabled={isPending}
                    >
                        {isPending && (
                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                        )}
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
