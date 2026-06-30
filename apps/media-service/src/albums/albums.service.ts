import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { Album } from '../entities/album.entity'
import { AlbumAsset } from '../entities/album-asset.entity'
import { Asset } from '../entities/asset.entity'
import { CreateAlbumDto } from './dto/create-album.dto'
import { UpdateAlbumDto } from './dto/update-album.dto'
import { ListAlbumsQueryDto } from './dto/list-albums-query.dto'
import type { AlbumDto } from '@photox/shared-types'

@Injectable()
export class AlbumsService {
  constructor(
    @InjectRepository(Album)
    private readonly repo: Repository<Album>,
    @InjectRepository(AlbumAsset)
    private readonly albumAssetRepo: Repository<AlbumAsset>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  async create(userId: string, dto: CreateAlbumDto): Promise<AlbumDto> {
    const album = new Album()
    album.userId = userId
    album.name = dto.name
    album.description = dto.description ?? null
    const saved = await this.repo.save(album)
    return this.toDto(saved, 0)
  }

  async list(userId: string, q: ListAlbumsQueryDto): Promise<{ items: AlbumDto[]; total: number }> {
    const limit = q.limit ?? 20
    const offset = q.offset ?? 0

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
      .where('aa.albumId IN (:...ids)', { ids })
      .groupBy('aa.albumId')
      .getRawMany<{ albumId: string; count: string }>()

    const countMap = new Map(rows.map((r) => [r.albumId, Number(r.count)]))

    return {
      items: items.map((a) => this.toDto(a, countMap.get(a.id) ?? 0)),
      total,
    }
  }

  async getOne(userId: string, id: string): Promise<AlbumDto> {
    const album = await this.repo.findOne({ where: { id, userId } })
    if (!album) throw new NotFoundException('Album not found')

    const count = await this.countAssets(id)
    return this.toDto(album, count)
  }

  async update(userId: string, id: string, dto: UpdateAlbumDto): Promise<AlbumDto> {
    const album = await this.repo.findOne({ where: { id, userId } })
    if (!album) throw new NotFoundException('Album not found')

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
    const album = await this.repo.findOne({ where: { id, userId } })
    if (!album) throw new NotFoundException('Album not found')
    await this.repo.delete({ id, userId })
  }

  async addAssets(userId: string, albumId: string, assetIds: string[]): Promise<AlbumDto> {
    const album = await this.repo.findOne({ where: { id: albumId, userId } })
    if (!album) throw new NotFoundException('Album not found')

    for (const assetId of assetIds) {
      const asset = await this.assetRepo.findOne({
        where: { id: assetId, userId, isTrashed: false },
      })
      if (!asset) {
        throw new NotFoundException(`Asset ${assetId} not found`)
      }
    }

    const rows = assetIds.map((assetId) => ({ albumId, assetId }))

    await this.albumAssetRepo
      .createQueryBuilder()
      .insert()
      .into(AlbumAsset)
      .values(rows)
      .orIgnore()
      .execute()

    return this.getOne(userId, albumId)
  }

  async removeAsset(userId: string, albumId: string, assetId: string): Promise<void> {
    const album = await this.repo.findOne({ where: { id: albumId, userId } })
    if (!album) throw new NotFoundException('Album not found')
    await this.albumAssetRepo.delete({ albumId, assetId })
  }

  async listAssets(
    userId: string,
    albumId: string,
    q: { limit?: number; offset?: number },
  ): Promise<{ items: Asset[]; total: number }> {
    const album = await this.repo.findOne({ where: { id: albumId, userId } })
    if (!album) throw new NotFoundException('Album not found')

    const limit = q.limit ?? 20
    const offset = q.offset ?? 0

    const joins = await this.albumAssetRepo
      .createQueryBuilder('aa')
      .select('aa.assetId', 'assetId')
      .addSelect('aa.addedAt', 'addedAt')
      .where('aa.albumId = :albumId', { albumId })
      .orderBy('aa.addedAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{ assetId: string }>()

    if (joins.length === 0) {
      return { items: [], total: 0 }
    }

    const ids = joins.map((j) => j.assetId)
    const fetched = await this.assetRepo.find({
      where: { id: In(ids), userId, isTrashed: false },
    })
    const orderMap = new Map(ids.map((id, i) => [id, i]))
    const items = fetched.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

    const total = await this.assetRepo
      .createQueryBuilder('a')
      .where('a.id IN (SELECT aa."assetId" FROM album_assets aa WHERE aa."albumId" = :albumId)', {
        albumId,
      })
      .andWhere('a.userId = :userId', { userId })
      .andWhere('a.isTrashed = false')
      .getCount()

    return { items, total }
  }

  private async countAssets(albumId: string): Promise<number> {
    const result = await this.albumAssetRepo
      .createQueryBuilder('aa')
      .where('aa."albumId" = :albumId', { albumId })
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
