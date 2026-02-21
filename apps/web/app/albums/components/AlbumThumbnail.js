import { ThumbnailImage } from "./ThumbnailImage";

export function AlbumThumbnail({ sampleMediaIds }) {
  const count = sampleMediaIds?.length || 0;

  if (count === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-card-dark text-slate-300">
        <span className="material-symbols-outlined text-6xl opacity-40">photo_library</span>
      </div>
    );
  }

  if (count === 1) {
    return <ThumbnailImage mediaId={sampleMediaIds[0]} />;
  }

  if (count === 2) {
    return (
      <div className="grid grid-cols-2 h-full w-full gap-0.5">
        <ThumbnailImage mediaId={sampleMediaIds[0]} />
        <ThumbnailImage mediaId={sampleMediaIds[1]} />
      </div>
    );
  }

  if (count === 3) {
    return (
      <div className="grid grid-cols-2 h-full w-full gap-0.5">
        <div className="h-full">
          <ThumbnailImage mediaId={sampleMediaIds[0]} />
        </div>
        <div className="grid grid-rows-2 gap-0.5 h-full">
          <ThumbnailImage mediaId={sampleMediaIds[1]} />
          <ThumbnailImage mediaId={sampleMediaIds[2]} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 grid-rows-2 h-full w-full gap-0.5">
      <ThumbnailImage mediaId={sampleMediaIds[0]} />
      <ThumbnailImage mediaId={sampleMediaIds[1]} />
      <ThumbnailImage mediaId={sampleMediaIds[2]} />
      <ThumbnailImage mediaId={sampleMediaIds[3]} />
    </div>
  );
}
