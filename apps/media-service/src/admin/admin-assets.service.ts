import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Asset } from '../entities/asset.entity'
import type { AdminAssetCountsResponse, AssetFailureCounts } from '@photox/shared-types'

const STUCK_PROCESSING_HOURS = 12

@Injectable()
export class AdminAssetsService {
  constructor(@InjectRepository(Asset) private readonly repo: Repository<Asset>) {}

  async getFailureCounts(): Promise<AdminAssetCountsResponse> {
    const stuckPredicate = `("metadataStatus" = 'pending' OR "thumbnailStatus" = 'pending' OR "transcodeStatus" = 'pending') AND "uploadedAt" < NOW() - INTERVAL '${STUCK_PROCESSING_HOURS} hours'`

    const rows = await this.repo
      .createQueryBuilder('a')
      .select('a.kind', 'kind')
      .addSelect(`COUNT(*) FILTER (WHERE ${stuckPredicate})`, 'processing')
      .addSelect(`COUNT(*) FILTER (WHERE "metadataStatus" = 'failed')`, 'metadata')
      .addSelect(`COUNT(*) FILTER (WHERE "thumbnailStatus" = 'failed')`, 'thumbnails')
      .addSelect(`COUNT(*) FILTER (WHERE "transcodeStatus" = 'failed')`, 'encoding')
      .where('a."isTrashed" = false')
      .groupBy('a.kind')
      .getRawMany<{
        kind: 'photo' | 'video'
        processing: string
        metadata: string
        thumbnails: string
        encoding: string
      }>()

    const empty: AssetFailureCounts = { processing: 0, metadata: 0, thumbnails: 0, encoding: 0 }
    const result: AdminAssetCountsResponse = {
      photos: { ...empty },
      videos: { ...empty },
    }

    for (const row of rows) {
      const target = row.kind === 'video' ? result.videos : result.photos
      target.processing = Number(row.processing)
      target.metadata = Number(row.metadata)
      target.thumbnails = Number(row.thumbnails)
      target.encoding = Number(row.encoding)
    }

    return result
  }
}
