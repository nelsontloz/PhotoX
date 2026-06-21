import { Injectable } from '@nestjs/common'
import { ProxyService } from '../../proxy/proxy.service'
import { buildHeaders } from '../../proxy/common/headers'
import { SERVICE_URLS } from '@photox/shared-config'
import type { Asset, AssetThumbnail, AssetThumbnailListResponse } from '@photox/shared-types'
import type { CurrentUser } from '../../auth/current-user.decorator'

export interface AssetDetailResponse {
  asset: Asset
  thumbnails: AssetThumbnail[]
  signedDownloadUrl?: string
}

@Injectable()
export class AssetDetailOrchestrator {
  constructor(private readonly proxy: ProxyService) {}

  async detail(
    user: CurrentUser,
    requestId: string,
    assetId: string,
  ): Promise<AssetDetailResponse> {
    const headers = buildHeaders(user, requestId)

    const [assetRes, thumbsRes] = await Promise.all([
      this.proxy.forward<Asset>(SERVICE_URLS['media-service'], {
        method: 'GET',
        path: `v1/assets/${assetId}`,
        headers,
      }),
      this.proxy
        .forward<AssetThumbnailListResponse>(SERVICE_URLS['media-service'], {
          method: 'GET',
          path: `v1/assets/${assetId}/thumbnails`,
          headers,
        })
        .catch(() => ({ status: 200, data: [] })),
    ])

    const asset = assetRes.data
    const thumbnails = thumbsRes.data ?? []
    const signedDownloadUrl = asset.fileId
      ? `${SERVICE_URLS['file-storage-service']}/v1/files/${asset.fileId}/download`
      : undefined

    return { asset, thumbnails, signedDownloadUrl }
  }
}
