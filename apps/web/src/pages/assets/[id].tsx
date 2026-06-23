import { Navigate, useParams, useLocation } from 'react-router-dom'
import type { Asset } from '@photox/shared-types'
import { RequireAuth } from '../../components/RequireAuth'
import { AssetViewer } from '../../components/AssetViewer/AssetViewer'

interface LocationState {
  context?: Asset[]
}

export default function AssetViewerRoute() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const state = (location.state ?? {}) as LocationState

  if (!id) return <Navigate to="/" replace />

  return (
    <RequireAuth>
      <AssetViewer
        assetId={id}
        contextAssets={state.context ?? []}
        onClose={() => window.history.back()}
      />
    </RequireAuth>
  )
}
