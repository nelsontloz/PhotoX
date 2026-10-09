import { NotFoundException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import type { Asset } from '../database/entities'

/** 404s when the asset doesn't exist or belongs to another user (same response either way). */
export async function assertAssetOwned(
  repo: Repository<Asset>,
  userId: string,
  assetId: string,
): Promise<void> {
  const asset = await repo.findOne({ where: { id: assetId, userId } })
  if (!asset) throw new NotFoundException('Asset not found')
}
