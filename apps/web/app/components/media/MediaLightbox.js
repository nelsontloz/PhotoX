"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMediaDetail } from "../../../lib/api";
import {
    formatModalDate,
    isVideoMimeType
} from "../../timeline/utils";

import { MediaRenderer } from "./MediaRenderer";
import { FilmstripThumb } from "./FilmstripThumb";

export function MediaLightbox({
    activeMediaId,
    activeItem,
    canGoPrev,
    canGoNext,
    isFetchingNextPage,
    filmstripItems = [],
    modalError,
    onClose,
    onPrevious,
    onNext,
    onSelectFilmstrip
}) {
    const [showInfo, setShowInfo] = useState(false);

    const detailQuery = useQuery({
        queryKey: ["media-detail", activeMediaId],
        queryFn: () => fetchMediaDetail(activeMediaId),
        enabled: Boolean(activeMediaId),
        staleTime: 5 * 60 * 1000
    });

    const detail = detailQuery.data?.media;
    const metadata = detail?.metadata || {};
    const imageExif = metadata.image || {};
    const videoExif = metadata.video || {};
    const fileName = activeMediaId ? activeMediaId.slice(0, 8).toUpperCase() + (isVideoMimeType(activeItem?.mimeType || detail?.mimeType) ? ".MP4" : ".JPG") : "LOADING...";
    const fileSize = "12.4 MB"; // Placeholder as size is not in DB
    const location = metadata.location || activeItem?.location || {};

    const currentTakenAt = activeItem?.takenAt || activeItem?.uploadedAt || detail?.takenAt || detail?.uploadedAt;
    const currentMimeType = activeItem?.mimeType || detail?.mimeType;

    if (detailQuery.isPending && !activeItem) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-dark/90 backdrop-blur-sm">
                <div className="text-center">
                    <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
                    <p className="text-white text-sm font-medium">Loading media...</p>
                </div>
            </div>
        );
    }

    return (
        <div
            className="fixed inset-0 z-50 flex overflow-hidden bg-background-dark font-display antialiased"
            role="dialog"
            aria-modal="true"
        >
            <div className="relative flex flex-1 flex-col min-w-0 h-full overflow-hidden">
                {/* Header */}
                <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-6 z-20 bg-gradient-to-b from-black/40 to-transparent">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onClose}
                            className="p-2 text-white/80 hover:text-white transition-colors"
                        >
                            <span className="material-symbols-outlined">arrow_back</span>
                        </button>
                        <div className="hidden md:block">
                            <h3 className="text-white text-sm font-medium">{fileName}</h3>
                            <p className="text-white/60 text-xs">
                                Shot on {formatModalDate(currentTakenAt)} • {fileSize}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="p-2 text-white/80 hover:text-white transition-colors" title="Favorite">
                            <span className={`material-symbols-outlined ${(activeItem?.flags?.favorite || detail?.flags?.favorite) ? "fill-1 text-primary" : ""}`}>favorite</span>
                        </button>
                        <button className="p-2 text-white/80 hover:text-white transition-colors" title="Download">
                            <span className="material-symbols-outlined">download</span>
                        </button>
                        <button className="p-2 text-white/80 hover:text-white transition-colors" title="Share">
                            <span className="material-symbols-outlined">share</span>
                        </button>
                        <button className="p-2 text-white/80 hover:text-white transition-colors" title="Edit">
                            <span className="material-symbols-outlined">edit</span>
                        </button>
                        <div className="w-px h-4 bg-white/20 mx-2"></div>
                        <button
                            onClick={() => setShowInfo(!showInfo)}
                            className={`p-2 transition-colors ${showInfo ? "text-primary" : "text-white/80 hover:text-white"}`}
                            title="Toggle Info"
                        >
                            <span className="material-symbols-outlined">info</span>
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex items-center justify-center p-8 relative min-h-0">
                    <button
                        disabled={!canGoPrev}
                        onClick={onPrevious}
                        className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white transition-all backdrop-blur-sm group z-10 disabled:opacity-0"
                    >
                        <span className="material-symbols-outlined text-3xl group-active:scale-90 transition-transform">chevron_left</span>
                    </button>

                    <MediaRenderer
                        mediaId={activeMediaId}
                        mimeType={currentMimeType}
                        className="shadow-2xl rounded-lg"
                    />

                    <button
                        disabled={!canGoNext || isFetchingNextPage}
                        onClick={onNext}
                        className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white transition-all backdrop-blur-sm group z-10 disabled:opacity-0"
                    >
                        <span className="material-symbols-outlined text-3xl group-active:scale-90 transition-transform">chevron_right</span>
                    </button>
                </div>

                {/* Filmstrip */}
                <div className="h-20 flex items-center justify-center px-6 gap-2 bg-gradient-to-t from-black/40 to-transparent">
                    <div className="flex gap-1 overflow-x-auto no-scrollbar py-2">
                        {filmstripItems.map((item) => (
                            <FilmstripThumb
                                key={item.id}
                                mediaId={item.id}
                                isActive={item.id === activeMediaId}
                                onSelect={() => onSelectFilmstrip(item.id)}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Sidebar Overlay */}
            <aside className={`absolute top-0 right-0 w-80 h-full bg-card-dark/95 backdrop-blur-md border-l border-border-dark flex flex-col shrink-0 z-40 transition-transform duration-300 ease-in-out shadow-2xl ${showInfo ? "translate-x-0" : "translate-x-full"}`}>
                <div className="h-16 flex items-center px-6 border-b border-border-dark shrink-0">
                    <h2 className="text-white font-semibold text-lg">Details</h2>
                    <button
                        onClick={() => setShowInfo(false)}
                        className="ml-auto p-1.5 text-slate-400 hover:text-white transition-colors"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto info-panel-scroll p-6 space-y-8 no-scrollbar">
                    <section>
                        <div className="flex items-center gap-2 text-slate-400 mb-2">
                            <span className="material-symbols-outlined text-[18px]">notes</span>
                            <h4 className="text-xs font-bold uppercase tracking-wider">Description</h4>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed font-normal">
                            {metadata.raw?.description || detail?.description || "No description provided for this media."}
                        </p>
                    </section>

                    <section>
                        <div className="flex items-center gap-2 text-slate-400 mb-4">
                            <span className="material-symbols-outlined text-[18px]">camera</span>
                            <h4 className="text-xs font-bold uppercase tracking-wider">Camera Info</h4>
                        </div>
                        <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-tight">Camera</p>
                                <p className="text-xs text-slate-200 font-medium">{imageExif.make || imageExif.model || "Unknown"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-tight">Lens</p>
                                <p className="text-xs text-slate-200 font-medium">{imageExif.lensModel || "Unknown Lens"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-tight">Aperture</p>
                                <p className="text-xs text-slate-200 font-medium">{imageExif.fNumber ? `f/${imageExif.fNumber}` : "Unknown"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-tight">Shutter</p>
                                <p className="text-xs text-slate-200 font-medium">{imageExif.exposureTime ? `${imageExif.exposureTime}s` : "Unknown"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-tight">ISO</p>
                                <p className="text-xs text-slate-200 font-medium">{imageExif.iso || "Unknown"}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-tight">Focal Length</p>
                                <p className="text-xs text-slate-200 font-medium">{imageExif.focalLength ? `${imageExif.focalLength}mm` : "Unknown"}</p>
                            </div>
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center gap-2 text-slate-400 mb-4">
                            <span className="material-symbols-outlined text-[18px]">location_on</span>
                            <h4 className="text-xs font-bold uppercase tracking-wider">Location</h4>
                        </div>
                        <div className="rounded-lg overflow-hidden border border-border-dark relative group cursor-pointer">
                            <div className="absolute inset-0 bg-primary/10 group-hover:bg-primary/5 transition-colors z-10"></div>
                            <img
                                alt="Static map of location"
                                className="w-full h-32 object-cover opacity-60 grayscale hover:grayscale-0 transition-all duration-500"
                                src={`https://maps.googleapis.com/maps/api/staticmap?center=${location.latitude || 0},${location.longitude || 0}&zoom=13&size=400x400&key=YOUR_API_KEY`} // Placeholder
                                onError={(e) => {
                                    e.target.src = "https://lh3.googleusercontent.com/aida-public/AB6AXuBtjTjm9PVzxEM-llbUa2Ea0d7pPUxpp0XFGzFKjAM3HR_SB4hUz8TZ8bMq4Ua0PK5tnCP_Le-j51IVeMuTUw1qmkL5IbcSsvoGFgYls61zKUJl191XgiYJEQrCONDqMdP8vH0-glq9m-xBiQYqwYx5tRzQONEoUREicTsbpywgVYe6ls3MOpexC5PQeO3S7gKaES2aSS_a9XwQCui9oEz0pOqH6Z6yfChQQdIbuAfnEiDY5l2URQQniEKEe4llekGM4D8BWWYGRA0";
                                }}
                            />
                            <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
                                <span className="material-symbols-outlined text-primary text-3xl">location_on</span>
                            </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-400 font-medium">{location.address || "Unknown Location"}</p>
                        <p className="text-[10px] text-slate-600">{location.latitude?.toFixed(4)}° N, {location.longitude?.toFixed(4)}° E</p>
                    </section>

                    <section>
                        <div className="flex items-center gap-2 text-slate-400 mb-4">
                            <span className="material-symbols-outlined text-[18px]">folder_open</span>
                            <h4 className="text-xs font-bold uppercase tracking-wider">Albums</h4>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-dashed border-slate-700 text-slate-500 text-[11px] font-medium hover:border-slate-500 hover:text-slate-300 transition-colors">
                                <span className="material-symbols-outlined text-[14px]">add</span>
                                Add to album
                            </button>
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center gap-2 text-slate-400 mb-4">
                            <span className="material-symbols-outlined text-[18px]">label</span>
                            <h4 className="text-xs font-bold uppercase tracking-wider">Keywords</h4>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {metadata.raw?.keywords?.map((kw, i) => (
                                <span key={i} className="text-[10px] bg-slate-800/50 text-slate-400 px-2 py-0.5 rounded">{kw}</span>
                            )) || (
                                    ["Mountain", "Sunset", "Snow", "Landscape", "Sky", "Outdoor"].map((kw, i) => (
                                        <span key={i} className="text-[10px] bg-slate-800/50 text-slate-400 px-2 py-0.5 rounded">{kw}</span>
                                    ))
                                )}
                        </div>
                    </section>
                </div>
                <div className="p-4 border-t border-border-dark">
                    <button className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-[18px]">history</span>
                        View Revision History
                    </button>
                </div>
            </aside>

            {modalError && (
                <p className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 rounded bg-red-900/70 px-3 py-1 text-xs text-white">
                    {modalError}
                </p>
            )}
        </div>
    );
}
