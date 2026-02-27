"use client";

export function Toast({ message, action, isVisible, onClose }) {
    if (!message) return null;

    return (
        <div className={`fixed top-20 right-6 z-[100] transition-all duration-300 transform ${isVisible ? "translate-x-0 opacity-100 scale-100" : "translate-x-8 opacity-0 scale-95"}`}>
            <div className="flex items-center gap-4 bg-slate-900/95 backdrop-blur-md border border-white/10 px-6 py-3.5 rounded-2xl shadow-2xl min-w-[320px] max-w-[90vw]">
                <div className="flex-1 flex items-center gap-3">
                    <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                        <span className="material-symbols-outlined text-lg">info</span>
                    </div>
                    <p className="text-sm font-medium text-white truncate">{message}</p>
                </div>

                {action && (
                    <button
                        onClick={() => {
                            action.onClick();
                            onClose();
                        }}
                        className="text-primary hover:text-primary-light text-xs font-bold uppercase tracking-wider px-2 py-1 transition-colors"
                    >
                        {action.label}
                    </button>
                )}

                <button
                    onClick={onClose}
                    className="p-1 text-white/40 hover:text-white transition-colors ml-1"
                    aria-label="Close"
                >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
            </div>
        </div>
    );
}
