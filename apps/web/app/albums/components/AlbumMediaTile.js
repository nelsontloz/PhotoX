"use client";

import { fetchMediaContentBlob } from "../../../lib/api";
import { isVideoMimeType } from "../../timeline/utils";
import { Spinner } from "../../timeline/components/Spinner";
import { useMediaBlobUrl } from "../../shared/hooks/useMediaBlobUrl";

export function AlbumMediaTile({ mediaId, mimeType, onOpen, onRemove }) {
  const { mediaUrl, loadError } = useMediaBlobUrl({
    queryKey: ["timeline-thumb", mediaId],
    queryFn: () => fetchMediaContentBlob(mediaId, "thumb")
  });

  return (
    <div className="masonry-item relative group rounded-lg overflow-hidden cursor-pointer bg-slate-200 dark:bg-card-dark">
      <div onClick={onOpen}>
        {mediaUrl ? (
          <img
            src={mediaUrl}
            alt="Album media"
            className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : loadError ? (
          <div className="flex aspect-square items-center justify-center p-4 text-xs text-red-600">{loadError}</div>
        ) : (
          <div className="flex aspect-square items-center justify-center">
            <Spinner label="" size="sm" className="text-slate-500" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {isVideoMimeType(mimeType) && (
          <div className="absolute top-3 right-3 opacity-100 group-hover:opacity-100 transition-opacity duration-200">
            <div className="bg-black/50 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-bold text-white flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">videocam</span>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        title="Remove from album"
        className="absolute top-2 right-2 size-7 rounded-full bg-black/60 hover:bg-red-600 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}
