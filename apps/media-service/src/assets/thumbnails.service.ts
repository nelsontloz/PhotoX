import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Asset } from '../entities/asset.entity'
import { AssetThumbnail } from '../entities/asset-thumbnail.entity'
import { RegisterThumbnailDto } from './dto/register-thumbnail.dto'
import type { AssetThumbnail as AssetThumbnailResponse } from '@photox/shared-types'

@Injectable()
export class ThumbnailsService {
  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AssetThumbnail)
    private readonly thumbRepo: Repository<AssetThumbnail>,
  ) {}

  async listForAsset(userId: string, assetId: string): Promise<AssetThumbnailResponse[]> {
    await this.assertAssetOwned(userId, assetId)
    const rows = await this.thumbRepo.find({
      where: { assetId },
      order: { createdAt: 'ASC' },
    })
    return rows.map((r) => this.toResponse(r))
  }

  async getForAsset(
    userId: string,
    assetId: string,
    size: string,
  ): Promise<AssetThumbnailResponse> {
    await this.assertAssetOwned(userId, assetId)
    const row = await this.thumbRepo.findOne({ where: { assetId, size } })
    if (!row) throw new NotFoundException('Thumbnail not found')
    return this.toResponse(row)
  }

  async register(assetId: string, dto: RegisterThumbnailDto): Promise<AssetThumbnailResponse> {
    await this.assertAssetExists(assetId)
    await this.thumbRepo.upsert(
      [
        {
          assetId,
          size: dto.size,
          fileId: dto.fileId,
          width: dto.width,
          height: dto.height,
          bytes: dto.bytes,
        },
      ],
      ['assetId', 'size'],
    )
    const row = await this.thumbRepo.findOneOrFail({ where: { assetId, size: dto.size } })
    return this.toResponse(row)
  }

  async unregister(assetId: string, size: string): Promise<void> {
    await this.assertAssetExists(assetId)
    await this.thumbRepo.delete({ assetId, size })
  }

  private async assertAssetOwned(userId: string, assetId: string): Promise<void> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
  }

  private async assertAssetExists(assetId: string): Promise<void> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } })
    if (!asset) throw new NotFoundException('Asset not found')
  }

  private toResponse(t: AssetThumbnail): AssetThumbnailResponse {
    return {
      size: t.size,
      fileId: t.fileId,
      width: t.width,
      height: t.height,
      bytes: Number(t.bytes),
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    }
  }
}
