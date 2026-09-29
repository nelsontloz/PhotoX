import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FaCircleExclamation } from 'react-icons/fa6'
import { api } from '../../api/client'
import { LoadingState } from '../../components/StateViews'
import type { PublicShareResponse } from '@photox/shared-types'

function getStreamUrl(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/stream`
}

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PublicShareResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const { asset } = data
  const isVideo = asset.kind === 'video'
  const streamUrl = token ? getStreamUrl(token) : ''

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      {isVideo ? (
        <video
          src={streamUrl}
          controls
          autoPlay
          className="max-w-full max-h-screen object-contain"
          title={asset.originalName ?? asset.title ?? 'Video'}
        />
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
