"use client";

import { fetchMediaContentBlob } from "../../../lib/api";
import { useMediaBlobUrl } from "../../shared/hooks/useMediaBlobUrl";

export function ThumbnailImage({ mediaId }) {
  const { mediaUrl, isLoading } = useMediaBlobUrl({
    queryKey: ["media", mediaId, "thumb"],
    queryFn: () => fetchMediaContentBlob(mediaId, "thumb"),
    staleTime: 1000 * 60 * 60
  });

  if (isLoading || !mediaUrl) {
    return <div className="bg-slate-200 dark:bg-slate-800 animate-pulse w-full h-full" />;
  }

  return <img src={mediaUrl} alt="" className="object-cover w-full h-full" />;
}
