"use client";

import { formatModalDate } from "../../../timeline/utils";

export function LightboxHeader({
    title,
    takenAt,
    fileSizeLabel,
    isFavorite,
    showInfo,
    onClose,
    onDelete,
    onToggleInfo,
    deleteInProgress
}) {
    return (
        <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-6 z-20 bg-gradient-to-b from-black/40 to-transparent">
            <div className="flex items-center gap-4">
                <button
                    type="button"
                    onClick={onClose}
                    className="p-2 text-white/80 hover:text-white transition-colors"
                    aria-label="Close media viewer"
                >
                    <span className="material-symbols-outlined">arrow_back</span>
                </button>
                <div className="hidden md:block">
                    <h3 id="media-lightbox-title" className="text-white text-sm font-medium">{title}</h3>
                    <p className="text-white/60 text-xs">
                        Shot on {formatModalDate(takenAt)} • {fileSizeLabel}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="p-2 text-white/80 hover:text-white transition-colors"
                    title="Favorite"
                    aria-label="Toggle favorite"
                >
                    <span className={`material-symbols-outlined ${isFavorite ? "fill-1 text-primary" : ""}`}>favorite</span>
                </button>
                <button
                    type="button"
                    className="p-2 text-white/80 hover:text-white transition-colors"
                    title="Download"
                    aria-label="Download media"
                >
                    <span className="material-symbols-outlined">download</span>
                </button>
                <button
                    type="button"
                    className="p-2 text-white/80 hover:text-white transition-colors"
                    title="Share"
                    aria-label="Share media"
                >
                    <span className="material-symbols-outlined">share</span>
                </button>
                <button
                    type="button"
                    className="p-2 text-white/80 hover:text-white transition-colors"
                    title="Edit"
                    aria-label="Edit media"
                >
                    <span className="material-symbols-outlined">edit</span>
                </button>
                {typeof onDelete === "function" ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={deleteInProgress}
                        className="p-2 text-white/80 hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Move to Trash"
                        aria-label="Move media to trash"
                    >
                        <span className="material-symbols-outlined">delete</span>
                    </button>
                ) : null}
                <div className="w-px h-4 bg-white/20 mx-2" aria-hidden="true"></div>
                <button
                    type="button"
                    onClick={onToggleInfo}
                    className={`p-2 transition-colors ${showInfo ? "text-primary" : "text-white/80 hover:text-white"}`}
                    title="Toggle Details"
                    aria-label="Toggle details panel"
                    aria-pressed={showInfo}
                >
                    <span className="material-symbols-outlined">info</span>
                </button>
            </div>
        </div>
    );
}
