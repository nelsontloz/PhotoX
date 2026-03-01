"use client";

export function LightboxNavButtons({ canGoPrev, canGoNext, isFetchingNextPage, onPrevious, onNext }) {
    return (
        <>
            <button
                type="button"
                disabled={!canGoPrev}
                onClick={onPrevious}
                className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white transition-all backdrop-blur-sm group z-10 disabled:opacity-0"
                aria-label="Previous media"
            >
                <span className="material-symbols-outlined text-3xl group-active:scale-90 transition-transform">chevron_left</span>
            </button>

            <button
                type="button"
                disabled={!canGoNext || isFetchingNextPage}
                onClick={onNext}
                className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white transition-all backdrop-blur-sm group z-10 disabled:opacity-0"
                aria-label="Next media"
            >
                <span className="material-symbols-outlined text-3xl group-active:scale-90 transition-transform">chevron_right</span>
            </button>
        </>
    );
}
