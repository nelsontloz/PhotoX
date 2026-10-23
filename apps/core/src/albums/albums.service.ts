import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { Album } from './entities/album.entity'
import { AlbumAsset } from './entities/album-asset.entity'
import { Asset } from '../database/entities'
import { findOwnedOr404 } from '../common/asset-ownership'
import { CreateAlbumDto } from './dto/create-album.dto'
import { UpdateAlbumDto } from './dto/update-album.dto'
import { PaginationQueryDto } from '../common/pagination-query.dto'
import { AssetsService } from '../assets/assets.service'
import type { AlbumDto, Asset as AssetResponse } from '@photox/shared-types'

@Injectable()
export class AlbumsService {
  constructor(
    @InjectRepository(Album)
    private readonly repo: Repository<Album>,
    @InjectRepository(AlbumAsset)
    private readonly albumAssetRepo: Repository<AlbumAsset>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly assets: AssetsService,
  ) {}

  async create(userId: string, dto: CreateAlbumDto): Promise<AlbumDto> {
    const album = new Album()
    album.userId = userId
    album.name = dto.name
    album.description = dto.description ?? null
    const saved = await this.repo.save(album)
    return this.toDto(saved, 0)
  }

  async list(userId: string, q: PaginationQueryDto): Promise<{ items: AlbumDto[]; total: number }> {
    const limit = q.limit
    const offset = q.offset

    const [items, total] = await this.repo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    })

    if (items.length === 0) {
      return { items: [], total }
    }

    const ids = items.map((a) => a.id)
    const rows = await this.repo
      .createQueryBuilder('a')
      .select('aa.albumId', 'albumId')
      .addSelect('COUNT(*)', 'count')
      .innerJoin('album_assets', 'aa', 'aa.albumId = a.id')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .where('aa.albumId IN (:...ids)', { ids })
      .andWhere('asset.isTrashed = false')
      .groupBy('aa.albumId')
      .getRawMany<{ albumId: string; count: string }>()

    const countMap = new Map(rows.map((r) => [r.albumId, Number(r.count)]))

    return {
      items: items.map((a) => this.toDto(a, countMap.get(a.id) ?? 0)),
      total,
    }
  }

  async getOne(userId: string, id: string): Promise<AlbumDto> {
    const album = await findOwnedOr404(this.repo, id, userId, 'Album')

    const count = await this.countAssets(id)
    return this.toDto(album, count)
  }

  async update(userId: string, id: string, dto: UpdateAlbumDto): Promise<AlbumDto> {
    const album = await findOwnedOr404(this.repo, id, userId, 'Album')

    const patch: Partial<Album> = {}
    if (dto.name !== undefined) patch.name = dto.name
    if (dto.description !== undefined) patch.description = dto.description

    if (Object.keys(patch).length === 0) {
      const count = await this.countAssets(id)
      return this.toDto(album, count)
    }

    await this.repo.update(id, patch)
    const updated = await this.repo.findOne({ where: { id } })
    const count = await this.countAssets(id)
    return this.toDto(updated!, count)
  }

  async delete(userId: string, id: string): Promise<void> {
    await findOwnedOr404(this.repo, id, userId, 'Album')
    await this.repo.delete({ id, userId })
  }

  async addAssets(userId: string, albumId: string, assetIds: string[]): Promise<void> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album')

    const uniqueIds = [...new Set(assetIds)]
    const found = await this.assetRepo.find({
      where: { id: In(uniqueIds), userId, isTrashed: false },
      select: { id: true },
    })
    if (found.length !== uniqueIds.length) {
      const foundIds = new Set(found.map((a) => a.id))
      const missing = uniqueIds.find((id) => !foundIds.has(id))
      throw new NotFoundException(`Asset ${missing} not found`)
    }

    const rows = assetIds.map((assetId) => ({ albumId, assetId }))

    await this.albumAssetRepo
      .createQueryBuilder()
      .insert()
      .into(AlbumAsset)
      .values(rows)
      .orIgnore()
      .execute()
  }

  async removeAsset(userId: string, albumId: string, assetId: string): Promise<void> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album')
    await this.albumAssetRepo.delete({ albumId, assetId })
  }

  async listAssets(
    userId: string,
    albumId: string,
    q: PaginationQueryDto,
  ): Promise<{ items: AssetResponse[]; total: number }> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album')

    const limit = q.limit
    const offset = q.offset

    const joins = await this.albumAssetRepo
      .createQueryBuilder('aa')
      .select('aa.assetId', 'assetId')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .where('aa.albumId = :albumId', { albumId })
      .andWhere('asset.isTrashed = false')
      .orderBy('aa.addedAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{ assetId: string }>()

    const total = await this.countAssets(albumId)
    const items = await this.assets.listByIdsRanked(
      userId,
      joins.map((j) => j.assetId),
    )

    return { items, total }
  }

  private async countAssets(albumId: string): Promise<number> {
    const result = await this.assetRepo
      .createQueryBuilder('a')
      .innerJoin('album_assets', 'aa', 'aa."assetId" = a.id')
      .where('aa."albumId" = :albumId', { albumId })
      .andWhere('a.isTrashed = false')
      .getCount()
    return result
  }

  private toDto(a: Album, assetCount: number): AlbumDto {
    return {
      id: a.id,
      userId: a.userId,
      name: a.name,
      description: a.description,
      assetCount,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
      updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt,
    }
  }
}
