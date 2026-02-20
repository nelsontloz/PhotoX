"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchMediaContentBlob, formatApiError, isRetriableMediaProcessingError } from "../../../lib/api";
import { isVideoMimeType } from "../utils";
import { Spinner } from "./Spinner";

const MEDIA_POLL_INTERVAL_MS = 2000;
const MEDIA_POLL_MAX_ATTEMPTS = 15;

export function TimelineModalMedia({ mediaId, mimeType }) {
    const [mediaUrl, setMediaUrl] = useState("");
    const [loadError, setLoadError] = useState("");
    const [retryCount, setRetryCount] = useState(0);
    const isVideo = isVideoMimeType(mimeType);
    const variant = isVideo ? "playback" : "small";

    useEffect(() => {
        setMediaUrl("");
        setLoadError("");
        setRetryCount(0);
    }, [mediaId, variant]);

    const mediaQuery = useQuery({
        queryKey: ["timeline-modal-media", mediaId, variant],
        queryFn: () => fetchMediaContentBlob(mediaId, variant),
        enabled: Boolean(mediaId),
        staleTime: 5 * 60 * 1000
    });
    const { isError: isMediaError, error: mediaError, refetch: refetchMedia } = mediaQuery;

    useEffect(() => {
        if (!mediaQuery.data) {
            return;
        }

        const nextUrl = URL.createObjectURL(mediaQuery.data);
        setMediaUrl(nextUrl);
        setLoadError("");

        return () => {
            URL.revokeObjectURL(nextUrl);
        };
    }, [mediaQuery.data]);

    useEffect(() => {
        if (isMediaError) {
            if (isRetriableMediaProcessingError(mediaError) && retryCount < MEDIA_POLL_MAX_ATTEMPTS) {
                const timeoutId = window.setTimeout(() => {
                    setRetryCount((count) => count + 1);
                    refetchMedia();
                }, MEDIA_POLL_INTERVAL_MS);

                return () => {
                    window.clearTimeout(timeoutId);
                };
            }

            setLoadError(formatApiError(mediaError));
        }
    }, [isMediaError, mediaError, refetchMedia, retryCount]);

    if (mediaUrl) {
        if (isVideo) {
            return (
                <video
                    src={mediaUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain"
                    onError={() => setLoadError("Video playback failed (MEDIA_PLAYBACK_ERROR)")}
                />
            );
        }

        return <img src={mediaUrl} alt="Selected media" className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain" />;
    }

    if (loadError) {
        return <div className="error w-full">Could not load media. {loadError}</div>;
    }

    return (
        <div className="flex h-[60vh] w-full items-center justify-center rounded-xl bg-[#d7e5eb]">
            <Spinner
                label={isVideo ? "Preparing video playback..." : "Preparing full preview..."}
                size="md"
                className="text-slate-700"
            />
        </div>
    );
}
