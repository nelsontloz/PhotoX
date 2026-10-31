import { useState } from 'react';
import type { CSSProperties } from 'react';
import { FaCircleExclamation } from 'react-icons/fa6';

interface VideoPlayerProps {
  src: string;
  fallbackSrc?: string;
  poster?: string;
  title?: string;
  className?: string;
  autoPlay?: boolean;
  /** width / height of the video; sizes the frame so portrait videos stay tall (defaults to 16:9). */
  aspectRatio?: number;
}

export function VideoPlayer({
  src,
  fallbackSrc,
  poster,
  title,
  className = '',
  autoPlay = false,
  aspectRatio = 16 / 9,
}: VideoPlayerProps) {
  const [failed, setFailed] = useState(false);
  const [swapped, setSwapped] = useState(false);

  // One retry on the fallback (the transcode or the original), then surface the failure.
  function handleError() {
    if (!swapped && fallbackSrc) setSwapped(true);
    else setFailed(true);
  }

  if (failed) {
    return (
      <div
        role="alert"
        className={[
          'flex flex-col items-center justify-center gap-3',
          'w-full aspect-video max-h-[80vh]',
          'bg-slate-100 dark:bg-card-dark',
          'border border-slate-200 dark:border-border-dark',
          'rounded-xl text-slate-500 dark:text-slate-400',
          'p-6 text-center',
          className,
        ].join(' ')}
      >
        <FaCircleExclamation className="text-4xl text-amber-500 dark:text-amber-400" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {title ? `Can't play "${title}"` : "This video can't be played"}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This video format isn't supported by your browser.
        </p>
      </div>
    );
  }

  // Frame sizing lives in app.css (.video-frame): it fits the media container's content box via
  // container query units, so the video never slides under the chrome (top bar, thumbnail strip)
  // that the container's padding reserves.
  return (
    <div
      className={[
        'video-frame relative bg-black rounded-xl overflow-hidden shadow-2xl',
        className,
      ].join(' ')}
      style={{ '--video-ar': aspectRatio } as CSSProperties}
    >
      <video
        src={swapped && fallbackSrc ? fallbackSrc : src}
        poster={poster}
        controls
        playsInline
        autoPlay={autoPlay}
        preload="metadata"
        aria-label={title ? `Video player for ${title}` : 'Video player'}
        onError={handleError}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
