import {
  formatModalDate,
  formatModalTime,
  formatDurationSeconds,
  formatDimensions,
  isVideoMimeType
} from "../utils";
import { TimelineModalMedia } from "./TimelineModalMedia";
import { FilmstripThumb } from "./FilmstripThumb";

export function TimelineLightbox({
  activeItem,
  activeMetadataPreview,
  canGoPrev,
  canGoNext,
  isFetchingNextPage,
  filmstripItems,
  modalError,
  onClose,
  onPrevious,
  onNext,
  onSelectFilmstrip
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background-dark/95 text-white backdrop-blur-md"
      role="dialog"
      aria-modal="true"
    >
      <header className="z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-6 py-6 transition-all duration-300">
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-semibold text-white transition-all backdrop-blur-sm"
            onClick={onClose}
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            <span>Back</span>
          </button>
          <div>
            <h2 className="text-base font-bold tracking-tight">{formatModalDate(activeItem.takenAt || activeItem.uploadedAt)}</h2>
            <div className="flex items-center gap-2 text-xs font-medium text-white/60">
              <span>{formatModalTime(activeItem.takenAt || activeItem.uploadedAt)}</span>
              <span className="h-1 w-1 rounded-full bg-white/40" />
              <span>{activeItem.mimeType || "image/jpeg"}</span>
              {formatDimensions(activeMetadataPreview?.width, activeMetadataPreview?.height) ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  <span>{formatDimensions(activeMetadataPreview?.width, activeMetadataPreview?.height)}</span>
                </>
              ) : null}
              {isVideoMimeType(activeItem.mimeType) && formatDurationSeconds(activeMetadataPreview?.durationSec) ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  <span>{formatDurationSeconds(activeMetadataPreview?.durationSec)}</span>
                </>
              ) : null}
              <span className="h-1 w-1 rounded-full bg-white/40" />
              <span>PhotoX Viewer</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-1 backdrop-blur-md">
            <button type="button" className="h-10 w-10 rounded-lg text-sm text-white/80 transition-all hover:bg-white/10 hover:text-cyan-300">Share</button>
            <button type="button" className="h-10 w-10 rounded-lg text-sm text-cyan-300 transition-all hover:bg-white/10">Fav</button>
            <button type="button" className="h-10 w-10 rounded-lg text-sm text-white/80 transition-all hover:bg-white/10 hover:text-cyan-300">Info</button>
            <button type="button" className="h-10 w-10 rounded-lg text-sm text-white/80 transition-all hover:bg-white/10 hover:text-red-400">Del</button>
          </div>
          <button
            type="button"
            className="h-10 w-10 rounded-full bg-white/10 text-white transition-all hover:bg-white/20"
            onClick={onClose}
          >
            X
          </button>
        </div>
      </header>

      <main className="group/main relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-24 pt-4 md:px-16">
        <button
          type="button"
          className="absolute left-4 z-10 rounded-full border border-white/10 bg-black/20 p-3 text-white opacity-0 transition-all duration-300 group-hover/main:translate-x-0 group-hover/main:opacity-100 hover:scale-110 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-20"
          onClick={onPrevious}
          disabled={!canGoPrev}
        >
          {"<"}
        </button>

        <div className="relative flex max-h-full max-w-full items-center justify-center shadow-2xl">
          <TimelineModalMedia mediaId={activeItem.id} mimeType={activeItem.mimeType} />
        </div>

        <button
          type="button"
          className="absolute right-4 z-10 rounded-full border border-white/10 bg-black/20 p-3 text-white opacity-0 transition-all duration-300 group-hover/main:translate-x-0 group-hover/main:opacity-100 hover:scale-110 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-20"
          onClick={onNext}
          disabled={!canGoNext || isFetchingNextPage}
        >
          {">"}
        </button>
      </main>

      <div className="z-20 flex h-24 w-full flex-col justify-end bg-gradient-to-t from-black/90 to-transparent pb-4">
        <div className="flex w-full justify-center px-4">
          <div className="flex max-w-full gap-3 overflow-x-auto py-2">
            {filmstripItems.map((item) => (
              <FilmstripThumb
                key={item.id}
                mediaId={item.id}
                isActive={item.id === activeItem.id}
                onSelect={() => onSelectFilmstrip(item.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {modalError ? <p className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 rounded bg-red-900/70 px-3 py-1 text-xs">{modalError}</p> : null}
    </div>
  );
}
