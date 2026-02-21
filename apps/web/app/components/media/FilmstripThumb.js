"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchMediaContentBlob } from "../../../lib/api";

export function FilmstripThumb({ mediaId, isActive, onSelect }) {
    const [thumbUrl, setThumbUrl] = useState("");

    const thumbQuery = useQuery({
        queryKey: ["media-thumb", mediaId],
        queryFn: () => fetchMediaContentBlob(mediaId, "thumb"),
        staleTime: 5 * 60 * 1000
    });

    useEffect(() => {
        if (!thumbQuery.data) {
            return;
        }

        const nextUrl = URL.createObjectURL(thumbQuery.data);
        setThumbUrl(nextUrl);

        return () => {
            URL.revokeObjectURL(nextUrl);
        };
    }, [thumbQuery.data]);

    return (
        <button
            type="button"
            onClick={onSelect}
            className={
                isActive
                    ? "relative h-10 w-10 shrink-0 overflow-hidden rounded border-2 border-primary"
                    : "relative h-10 w-10 shrink-0 overflow-hidden rounded border-2 border-transparent opacity-50 transition-opacity hover:opacity-100"
            }
        >
            {thumbUrl ? (
                <img src={thumbUrl} alt="Filmstrip thumbnail" className="h-full w-full object-cover" />
            ) : (
                <div className="h-full w-full animate-pulse bg-slate-600" />
            )}
        </button>
    );
}
