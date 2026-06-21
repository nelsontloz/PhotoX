import { Injectable, Logger } from '@nestjs/common'
import { ProxyService } from '../../proxy/proxy.service'
import { buildHeaders } from '../../proxy/common/headers'
import { SERVICE_URLS } from '@photox/shared-config'
import type { Asset, AssetListResponse, FileRecord, BatchFilesResponse } from '@photox/shared-types'
import type { CurrentUser } from '../../auth/current-user.decorator'

export interface AssetSummary extends Asset {
  signedDownloadUrl?: string
}

export interface AssetSummaryListResponse {
  items: AssetSummary[]
  total: number
  limit: number
  offset: number
}

@Injectable()
export class AssetListOrchestrator {
  private readonly logger = new Logger(AssetListOrchestrator.name)

  constructor(private readonly proxy: ProxyService) {}

  async list(
    user: CurrentUser,
    requestId: string,
    query: { limit?: string; offset?: string; isTrashed?: string },
  ): Promise<AssetSummaryListResponse> {
    const headers = buildHeaders(user, requestId)

    const result = await this.proxy.forward<AssetListResponse>(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: 'v1/assets',
      query: {
        limit: query.limit ?? '20',
        offset: query.offset ?? '0',
        isTrashed: query.isTrashed ?? 'false',
      },
      headers,
    })

    const assets = result.data.items
    if (assets.length === 0) {
      return { items: [], total: 0, limit: result.data.limit, offset: result.data.offset }
    }

    const fileIds = assets.map((a) => a.fileId).filter(Boolean)
    const fileMap = new Map<string, FileRecord>()

    if (fileIds.length > 0) {
      try {
        const batch = await this.proxy.forward<BatchFilesResponse>(
          SERVICE_URLS['file-storage-service'],
          {
            method: 'POST',
            path: 'v1/internal/files/batch',
            body: { fileIds },
            headers,
            timeout: 10_000,
          },
        )
        for (const f of batch.data.items) {
          fileMap.set(f.id, f)
        }
      } catch (err) {
        this.logger.warn({
          requestId,
          error: (err as Error).message,
          message: 'Failed to fetch file batch, signing URLs omitted',
        })
      }
    }

    const items: AssetSummary[] = assets.map((a) => {
      const item: AssetSummary = { ...a }
      const file = a.fileId ? fileMap.get(a.fileId) : undefined
      if (file) {
        item.signedDownloadUrl = `${SERVICE_URLS['file-storage-service']}/v1/files/${file.id}/download`
      }
      return item
    })

    return { items, total: result.data.total, limit: result.data.limit, offset: result.data.offset }
  }
}
