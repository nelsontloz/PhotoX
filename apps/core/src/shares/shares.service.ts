import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import * as crypto from 'crypto'
import { Share } from './entities/share.entity'
import { Asset } from '../database/entities'
import { Album } from '../albums/entities/album.entity'
import { AlbumAsset } from '../albums/entities/album-asset.entity'
import { CreateShareDto } from './dto/create-share.dto'
import type {
  AlbumShareDto,
  AssetShareDto,
  PublicAlbumAssetsResponse,
  PublicShareAsset,
  PublicShareResponse,
  ShareDto,
  ShareListResponse,
} from '@photox/shared-types'

@Injectable()
export class SharesService {
  constructor(
    @InjectRepository(Share)
    private readonly shareRepo: Repository<Share>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(Album)
    private readonly albumRepo: Repository<Album>,
    @InjectRepository(AlbumAsset)
    private readonly albumAssetRepo: Repository<AlbumAsset>,
  ) {}

  async create(userId: string, dto: CreateShareDto): Promise<ShareDto> {
    const assetId = dto.assetId
    const albumId = dto.albumId
    if ((assetId === undefined) === (albumId === undefined)) {
      throw new BadRequestException('Provide exactly one of assetId or albumId')
    }

    if (assetId !== undefined) {
      const asset = await this.assetRepo.findOne({
        where: { id: assetId, userId, isTrashed: false },
      })
      if (!asset) throw new NotFoundException('Asset not found')

      const existing = await this.shareRepo.findOne({
        where: { assetId, userId },
        relations: ['asset', 'asset.thumbnails'],
      })
      if (existing) return this.toAssetDto(existing)

      const share = this.shareRepo.create({
        userId,
        kind: 'asset',
        assetId,
        albumId: null,
        token: crypto.randomBytes(16).toString('base64url'),
      })
      const saved = await this.shareRepo.save(share)
      return this.toAssetDto(saved)
    }

    const album = await this.albumRepo.findOne({ where: { id: albumId, userId } })
    if (!album) throw new NotFoundException('Album not found')

    const existing = await this.shareRepo.findOne({ where: { albumId, userId } })
    if (existing) return this.toAlbumDto(existing, album)

    const share = this.shareRepo.create({
      userId,
      kind: 'album',
      assetId: null,
      albumId,
      token: crypto.randomBytes(16).toString('base64url'),
    })
    const saved = await this.shareRepo.save(share)
    return this.toAlbumDto(saved, album)
  }

  async list(userId: string): Promise<ShareListResponse> {
    const rows = await this.shareRepo
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.asset', 'asset')
      .leftJoinAndSelect('asset.thumbnails', 'thumb')
      .leftJoinAndSelect('share.album', 'album')
      .where('share.userId = :userId', { userId })
      .andWhere('(share.kind = :albumKind OR asset.isTrashed = false)', { albumKind: 'album' })
      .orderBy('share.createdAt', 'DESC')
      .getMany()

    // ponytail: N+1 count/cover query per album share — fine for a personal scale library;
    // replace with a grouped join if share lists ever get large
    const items: ShareDto[] = []
    for (const row of rows) {
      items.push(
        row.kind === 'album' ? await this.toAlbumDto(row, row.album) : this.toAssetDto(row),
      )
    }
    return { items }
  }

  async revoke(userId: string, shareId: string): Promise<void> {
    const share = await this.shareRepo.findOne({ where: { id: shareId, userId } })
    if (!share) throw new NotFoundException('Share not found')
    await this.shareRepo.delete(shareId)
  }

  async getByToken(token: string): Promise<PublicShareResponse> {
    const share = await this.shareRepo.findOne({
      where: { token },
      relations: ['asset', 'asset.thumbnails', 'album'],
    })
    if (!share) throw new NotFoundException('Share not found')

    if (share.kind === 'album') {
      if (!share.album) throw new NotFoundException('Share not found')
      const shareDto = await this.toAlbumDto(share, share.album)
      return {
        kind: 'album',
        share: shareDto,
        album: {
          id: share.album.id,
          name: share.album.name,
          description: share.album.description,
          assetCount: shareDto.albumAssetCount,
        },
      }
    }

    if (!share.asset || share.asset.isTrashed) throw new NotFoundException('Share not found')
    return { kind: 'asset', share: this.toAssetDto(share), asset: this.toPublicAsset(share.asset) }
  }

  async listAlbumAssetsByToken(token: string): Promise<PublicAlbumAssetsResponse> {
    const share = await this.getAlbumShare(token)
    const rows = await this.albumAssetRepo
      .createQueryBuilder('aa')
      .select('aa."assetId"', 'assetId')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .where('aa."albumId" = :albumId', { albumId: share.albumId })
      .andWhere('asset.isTrashed = false')
      .orderBy('aa."addedAt"', 'DESC')
      .getRawMany<{ assetId: string }>()

    if (rows.length === 0) return { items: [] }

    const assets = await this.assetRepo.findBy({ id: In(rows.map((row) => row.assetId)) })
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    const items: PublicShareAsset[] = []
    for (const row of rows) {
      const asset = byId.get(row.assetId)
      if (asset) items.push(this.toPublicAsset(asset))
    }
    return { items }
  }

  async getAlbumAssetFileId(token: string, assetId: string, size?: string): Promise<string> {
    const share = await this.getAlbumShare(token)

    const member = await this.albumAssetRepo
      .createQueryBuilder('aa')
      .select('aa."assetId"', 'assetId')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .where('aa."albumId" = :albumId', { albumId: share.albumId })
      .andWhere('aa."assetId" = :assetId', { assetId })
      .andWhere('asset.isTrashed = false')
      .getRawOne<{ assetId: string }>()
    if (!member) throw new NotFoundException('Asset not found')

    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
      relations: ['thumbnails'],
    })
    if (!asset) throw new NotFoundException('Asset not found')

    if (size === 'sm') {
      return asset.thumbnails?.find((thumb) => thumb.size === 'sm')?.fileId ?? asset.fileId
    }
    return asset.fileId
  }

  private async getAlbumShare(token: string): Promise<Share> {
    const share = await this.shareRepo.findOne({ where: { token } })
    if (share?.kind !== 'album' || !share.albumId) {
      throw new NotFoundException('Share not found')
    }
    return share
  }

  private toPublicAsset(asset: Asset): PublicShareAsset {
    return {
      id: asset.id,
      userId: asset.userId,
      kind: asset.kind,
      fileId: asset.fileId,
      title: asset.title,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      takenAt: asset.takenAt instanceof Date ? asset.takenAt.toISOString() : asset.takenAt,
    }
  }

  private toAssetDto(share: Share): AssetShareDto {
    return {
      id: share.id,
      kind: 'asset',
      userId: share.userId,
      token: share.token,
      assetId: share.assetId!,
      assetFileId: share.asset?.fileId ?? null,
      assetThumbFileId: share.asset?.thumbnails?.find((t) => t.size === 'sm')?.fileId ?? null,
      assetKind: share.asset?.kind ?? null,
      createdAt: share.createdAt instanceof Date ? share.createdAt.toISOString() : share.createdAt,
    }
  }

  private async toAlbumDto(share: Share, album?: Album | null): Promise<AlbumShareDto> {
    const albumId = share.albumId!
    const albumRow = album ?? (await this.albumRepo.findOne({ where: { id: albumId } }))
    const [assetCount, coverThumbFileId] = await Promise.all([
      this.countAlbumAssets(albumId),
      this.coverThumbFileId(albumId),
    ])
    return {
      id: share.id,
      kind: 'album',
      userId: share.userId,
      token: share.token,
      albumId,
      albumName: albumRow?.name ?? '',
      albumAssetCount: assetCount,
      albumCoverThumbFileId: coverThumbFileId,
      createdAt: share.createdAt instanceof Date ? share.createdAt.toISOString() : share.createdAt,
    }
  }

  private async countAlbumAssets(albumId: string): Promise<number> {
    return this.albumAssetRepo
      .createQueryBuilder('aa')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .where('aa."albumId" = :albumId', { albumId })
      .andWhere('asset.isTrashed = false')
      .getCount()
  }

  private async coverThumbFileId(albumId: string): Promise<string | null> {
    const row = await this.albumAssetRepo
      .createQueryBuilder('aa')
      .select('thumb."fileId"', 'fileId')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .innerJoin('asset_thumbnails', 'thumb', 'thumb."assetId" = asset.id AND thumb.size = :size', {
        size: 'sm',
      })
      .where('aa."albumId" = :albumId', { albumId })
      .andWhere('asset.isTrashed = false')
      .orderBy('aa."addedAt"', 'DESC')
      .limit(1)
      .getRawOne<{ fileId: string }>()
    return row?.fileId ?? null
  }
}
