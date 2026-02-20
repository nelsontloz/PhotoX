"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchMediaContentBlob, formatApiError } from "../../../lib/api";
import { isVideoMimeType, formatDurationSeconds } from "../utils";
import { Spinner } from "./Spinner";

export function TimelineThumbnail({ item, onOpen, className = "" }) {
    const [imageUrl, setImageUrl] = useState("");
    const [loadError, setLoadError] = useState("");
    const mediaId = item.id;

    const thumbQuery = useQuery({
        queryKey: ["timeline-thumb", mediaId],
        queryFn: () => fetchMediaContentBlob(mediaId, "thumb"),
        staleTime: 5 * 60 * 1000
    });

    useEffect(() => {
        if (!thumbQuery.data) {
            return;
        }

        const nextUrl = URL.createObjectURL(thumbQuery.data);
        setImageUrl(nextUrl);
        setLoadError("");

        return () => {
            URL.revokeObjectURL(nextUrl);
        };
    }, [thumbQuery.data]);

    useEffect(() => {
        if (thumbQuery.isError) {
            setLoadError(formatApiError(thumbQuery.error));
        }
    }, [thumbQuery.error, thumbQuery.isError]);

    return (
        <div
            onClick={onOpen}
            className={`masonry-item relative group rounded-lg overflow-hidden cursor-pointer bg-slate-200 dark:bg-card-dark ${className}`}
        >
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt="Uploaded media"
                    className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                />
            ) : loadError ? (
                <div className="flex aspect-square items-center justify-center p-4 text-xs text-red-600">
                    {loadError}
                </div>
            ) : (
                <div className="flex aspect-square items-center justify-center">
                    <Spinner label="" size="sm" className="text-slate-500" />
                </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

            {/* Selection Circle */}
            <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <div className="w-6 h-6 rounded-full border-2 border-white/80 hover:bg-primary hover:border-primary flex items-center justify-center transition-colors">
                    <span className="material-symbols-outlined text-white text-[16px] hidden">check</span>
                </div>
            </div>

            {/* Video Indicator */}
            {isVideoMimeType(item.mimeType) && (
                <div className="absolute top-3 right-3 opacity-100 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="bg-black/50 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-bold text-white flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">videocam</span>
                    </div>
                </div>
            )}

            {/* Hover Metadata */}
            <div className="absolute bottom-3 left-3 right-3 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 translate-y-2 group-hover:translate-y-0">
                <p className="text-xs font-medium truncate">
                    {item.metadataPreview?.durationSec ? formatDurationSeconds(item.metadataPreview.durationSec) : ""}
                    {item.takenAt ? ` • ${new Date(item.takenAt).toLocaleDateString()}` : ""}
                </p>
            </div>
        </div>
    );
}
