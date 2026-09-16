import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as crypto from 'crypto'
import { AssetShare } from './entities/asset-share.entity'
import { Asset } from '@photox/data-access'
import { CreateShareDto } from './dto/create-share.dto'
import type { AssetShareDto, ShareListResponse, PublicShareResponse } from '@photox/shared-types'

@Injectable()
export class SharesService {
  constructor(
    @InjectRepository(AssetShare)
    private readonly shareRepo: Repository<AssetShare>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  async create(userId: string, dto: CreateShareDto): Promise<AssetShareDto> {
    const asset = await this.assetRepo.findOne({
      where: { id: dto.assetId, userId, isTrashed: false },
    })
    if (!asset) throw new NotFoundException('Asset not found')

    const existing = await this.shareRepo.findOne({
      where: { assetId: dto.assetId, userId },
    })
    if (existing) return this.toDto(existing)

    const share = new AssetShare()
    share.userId = userId
    share.assetId = dto.assetId
    share.token = crypto.randomBytes(16).toString('base64url')
    const saved = await this.shareRepo.save(share)
    return this.toDto(saved)
  }

  async list(userId: string): Promise<ShareListResponse> {
    const items = await this.shareRepo
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.asset', 'asset')
      .leftJoinAndSelect('asset.thumbnails', 'thumb')
      .where('share.userId = :userId', { userId })
      .andWhere('asset.isTrashed = false')
      .orderBy('share.createdAt', 'DESC')
      .getMany()

    return { items: items.map((s) => this.toDto(s)) }
  }

  async revoke(userId: string, shareId: string): Promise<void> {
    const share = await this.shareRepo.findOne({ where: { id: shareId, userId } })
    if (!share) throw new NotFoundException('Share not found')
    await this.shareRepo.delete(shareId)
  }

  async getByToken(token: string): Promise<PublicShareResponse> {
    const share = await this.shareRepo.findOne({
      where: { token },
      relations: ['asset'],
    })
    if (!share?.asset || share.asset.isTrashed)
      throw new NotFoundException('Share not found')

    return {
      share: this.toDto(share),
      asset: {
        id: share.asset.id,
        userId: share.asset.userId,
        kind: share.asset.kind,
        fileId: share.asset.fileId,
        title: share.asset.title,
        originalName: share.asset.originalName,
        mimeType: share.asset.mimeType,
        width: share.asset.width,
        height: share.asset.height,
        durationSeconds: share.asset.durationSeconds,
        takenAt:
          share.asset.takenAt instanceof Date
            ? share.asset.takenAt.toISOString()
            : share.asset.takenAt,
      },
    }
  }

  private toDto(s: AssetShare): AssetShareDto {
    return {
      id: s.id,
      assetId: s.assetId,
      userId: s.userId,
      token: s.token,
      assetFileId: s.asset?.fileId ?? null,
      assetThumbFileId: s.asset?.thumbnails?.find((t) => t.size === 'sm')?.fileId ?? null,
      assetKind: s.asset?.kind ?? null,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    }
  }
}
