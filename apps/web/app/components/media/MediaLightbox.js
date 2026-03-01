"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMediaDetail } from "../../../lib/api";
import { isVideoMimeType } from "../../timeline/utils";

import { MediaRenderer } from "./MediaRenderer";
import { LightboxHeader } from "./lightbox/LightboxHeader";
import { LightboxNavButtons } from "./lightbox/LightboxNavButtons";
import { LightboxFilmstrip } from "./lightbox/LightboxFilmstrip";
import { LightboxInfoPanel } from "./lightbox/LightboxInfoPanel";

export function MediaLightbox({
    activeMediaId,
    activeItem,
    canGoPrev,
    canGoNext,
    isFetchingNextPage,
    filmstripItems = [],
    modalError,
    onClose,
    onDelete,
    onPrevious,
    onNext,
    onSelectFilmstrip,
    deleteInProgress = false
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
            aria-labelledby="media-lightbox-title"
        >
            <div className="relative flex flex-1 flex-col min-w-0 h-full overflow-hidden">
                <LightboxHeader
                    title={fileName}
                    takenAt={currentTakenAt}
                    fileSizeLabel={fileSize}
                    isFavorite={Boolean(activeItem?.flags?.favorite || detail?.flags?.favorite)}
                    showInfo={showInfo}
                    onClose={onClose}
                    onDelete={onDelete}
                    onToggleInfo={() => setShowInfo((current) => !current)}
                    deleteInProgress={deleteInProgress}
                />

                {/* Main Content */}
                <div className="flex-1 flex items-center justify-center p-8 relative min-h-0">
                    <LightboxNavButtons
                        canGoPrev={canGoPrev}
                        canGoNext={canGoNext}
                        isFetchingNextPage={isFetchingNextPage}
                        onPrevious={onPrevious}
                        onNext={onNext}
                    />

                    <MediaRenderer
                        mediaId={activeMediaId}
                        mimeType={currentMimeType}
                        className="shadow-2xl rounded-lg"
                    />
                </div>

                <LightboxFilmstrip
                    items={filmstripItems}
                    activeMediaId={activeMediaId}
                    onSelect={onSelectFilmstrip}
                />
            </div>

            <LightboxInfoPanel
                showInfo={showInfo}
                metadata={metadata}
                detail={detail}
                location={location}
                onClose={() => setShowInfo(false)}
            />

            {modalError && (
                <p className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 rounded bg-red-900/70 px-3 py-1 text-xs text-white">
                    {modalError}
                </p>
            )}
        </div>
    );
}
