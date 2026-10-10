import { lazy, Suspense, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FaCircleExclamation, FaPhotoFilm, FaPlay, FaXmark } from 'react-icons/fa6'
import { api } from '../../api/client'
import { LoadingState } from '../../components/StateViews'
import type {
  PublicAlbumAssetsResponse,
  PublicAlbumShareResponse,
  PublicShareAsset,
  PublicShareResponse,
} from '@photox/shared-types'

// video.js loads only when a shared item is actually a video.
const VideoPlayer = lazy(() =>
  import('../../components/VideoPlayer').then((m) => ({ default: m.VideoPlayer })),
)

function getStreamUrl(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/stream`
}

function getAlbumAssetUrl(token: string, assetId: string, size?: 'sm'): string {
  const query = size ? `?size=${size}` : ''
  return `/api/share/${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}/stream${query}`
}

function AlbumShare({
  token,
  album,
  assets,
}: {
  token: string
  album: PublicAlbumShareResponse['album']
  assets: PublicShareAsset[]
}) {
  const [selected, setSelected] = useState<PublicShareAsset | null>(null)

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [selected])

  return (
    <div className="min-h-screen bg-background-dark">
      <header className="border-b border-border-dark">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">{album.name}</h1>
          {album.description && (
            <p className="text-sm text-slate-400 mt-2 max-w-3xl whitespace-pre-line">
              {album.description}
            </p>
          )}
          <p className="text-sm text-slate-500 mt-1">
            {album.assetCount} {album.assetCount === 1 ? 'item' : 'items'}
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <FaPhotoFilm className="text-4xl text-slate-600" />
            <p className="text-slate-400 text-sm">No items in this album yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSelected(asset)}
                className="group relative aspect-square overflow-hidden rounded-lg bg-card-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <img
                  src={getAlbumAssetUrl(token, asset.id, 'sm')}
                  alt={asset.title ?? asset.originalName ?? ''}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {asset.kind === 'video' && (
                  <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 p-1.5 pointer-events-none">
                    <FaPlay className="text-[10px] text-white" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 [container-type:size]"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
          aria-label={selected.title ?? selected.originalName ?? 'Media viewer'}
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white transition-colors"
            aria-label="Close"
          >
            <FaXmark className="text-2xl" />
          </button>
          {selected.kind === 'video' ? (
            <div onClick={(e) => e.stopPropagation()}>
              <Suspense fallback={null}>
                <VideoPlayer
                  src={getAlbumAssetUrl(token, selected.id)}
                  type={selected.mimeType ?? undefined}
                  autoPlay
                  title={selected.title ?? selected.originalName ?? undefined}
                  aspectRatio={
                    selected.width != null && selected.height != null
                      ? selected.width / selected.height
                      : undefined
                  }
                />
              </Suspense>
            </div>
          ) : (
            <img
              src={getAlbumAssetUrl(token, selected.id)}
              alt={selected.title ?? selected.originalName ?? 'Photo'}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[90vh] object-contain"
            />
          )}
        </div>
      )}
    </div>
  )
}

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PublicShareResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [albumAssets, setAlbumAssets] = useState<PublicShareAsset[] | null>(null)
  const [albumError, setAlbumError] = useState(false)
  const [albumReloadKey, setAlbumReloadKey] = useState(0)
  const isAlbum = data?.kind === 'album'

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const { data: res } = await api.get<PublicShareResponse>(`/share/${token}`)
        if (!cancelled) setData(res)
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? 'Share not found')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (!token || !isAlbum) return
    let cancelled = false
    void (async () => {
      try {
        const { data: res } = await api.get<PublicAlbumAssetsResponse>(`/share/${token}/assets`)
        if (!cancelled) setAlbumAssets(res.items)
      } catch {
        if (!cancelled) setAlbumError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, isAlbum, albumReloadKey])

  if (loading) {
    return (
      <LoadingState className="flex items-center justify-center min-h-screen bg-background-dark" />
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background-dark gap-4 px-4">
        <FaCircleExclamation className="text-4xl text-red-400" />
        <p className="text-slate-300 text-lg font-medium">Share not found</p>
        <p className="text-slate-500 text-sm">This link may have been revoked or expired.</p>
      </div>
    )
  }

  if (data.kind === 'album') {
    if (albumError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background-dark gap-4 px-4">
          <FaCircleExclamation className="text-4xl text-red-400" />
          <p className="text-slate-300 text-lg font-medium">Could not load this album</p>
          <button
            type="button"
            onClick={() => {
              setAlbumError(false)
              setAlbumAssets(null)
              setAlbumReloadKey((key) => key + 1)
            }}
            className="text-primary text-sm font-medium hover:underline"
          >
            Try again
          </button>
        </div>
      )
    }
    if (albumAssets === null) {
      return (
        <LoadingState className="flex items-center justify-center min-h-screen bg-background-dark" />
      )
    }
    return <AlbumShare token={token ?? ''} album={data.album} assets={albumAssets} />
  }

  const { asset } = data
  const isVideo = asset.kind === 'video'
  const streamUrl = token ? getStreamUrl(token) : ''

  return (
    <div className="flex items-center justify-center min-h-screen bg-black [container-type:size]">
      {isVideo ? (
        <Suspense fallback={null}>
          <VideoPlayer
            src={streamUrl}
            type={asset.mimeType ?? undefined}
            autoPlay
            title={asset.originalName ?? asset.title ?? undefined}
          />
        </Suspense>
      ) : (
        <img
          src={streamUrl}
          alt={asset.originalName ?? asset.title ?? 'Photo'}
          className="max-w-full max-h-screen object-contain"
        />
      )}
    </div>
  )
}
