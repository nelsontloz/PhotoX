"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchMediaContentBlob } from "../../../lib/api";

export function FilmstripThumb({ mediaId, isActive, onSelect }) {
    const [thumbUrl, setThumbUrl] = useState("");

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
                    ? "relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-black"
                    : "relative h-12 w-16 shrink-0 overflow-hidden rounded opacity-60 transition-all hover:scale-105 hover:opacity-100 border border-white/10"
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
