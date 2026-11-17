import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Album } from '../database/entities/album.entity';
import { AlbumAsset } from '../database/entities/album-asset.entity';
import { findOwnedOr404 } from '../common/asset-ownership';
import { apiError } from '../common/api-error';
import { pageAlbumAssetIds } from './album-assets.page';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { ListAlbumAssetsQueryDto } from './dto/list-album-assets-query.dto';
import { PaginationQueryDto } from '../common/pagination-query.dto';
import { AssetsService } from '../assets/assets.service';
import type { AlbumDto, AssetListResponse, AlbumListResponse } from '@photox/shared-types';

@Injectable()
export class AlbumsService {
  constructor(
    @InjectRepository(Album)
    private readonly repo: Repository<Album>,
    @InjectRepository(AlbumAsset)
    private readonly albumAssetRepo: Repository<AlbumAsset>,
    private readonly assets: AssetsService,
  ) {}

  async create(userId: string, dto: CreateAlbumDto): Promise<AlbumDto> {
    const album = new Album();
    album.userId = userId;
    album.name = dto.name;
    album.description = dto.description ?? null;
    album.hiddenFromTimeline = dto.hiddenFromTimeline ?? false;
    const saved = await this.repo.save(album);
    return this.toDto(saved, 0);
  }

  async list(userId: string, q: PaginationQueryDto): Promise<AlbumListResponse> {
    const limit = q.limit;
    const offset = q.offset;

    const [items, total] = await this.repo.findAndCount({
      where: { userId },
      // id completes the sort key: albums created in the same second would otherwise page
      // non-deterministically and repeat or skip rows
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });

    if (items.length === 0) {
      return { items: [], total };
    }

    const ids = items.map((a) => a.id);
    const rows = await this.repo
      .createQueryBuilder('a')
      .select('aa.albumId', 'albumId')
      .addSelect('COUNT(*)', 'count')
      .innerJoin('album_assets', 'aa', 'aa.albumId = a.id')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .where('aa.albumId IN (:...ids)', { ids })
      .andWhere('asset.isTrashed = false')
      .groupBy('aa.albumId')
      .getRawMany<{ albumId: string; count: string }>();

    const countMap = new Map(rows.map((r) => [r.albumId, Number(r.count)]));

    return {
      items: items.map((a) => this.toDto(a, countMap.get(a.id) ?? 0)),
      total,
    };
  }

  async getOne(userId: string, id: string): Promise<AlbumDto> {
    const album = await findOwnedOr404(this.repo, id, userId, 'Album');

    const count = await this.assets.countActiveInAlbum(id);
    return this.toDto(album, count);
  }

  async update(userId: string, id: string, dto: UpdateAlbumDto): Promise<AlbumDto> {
    const album = await findOwnedOr404(this.repo, id, userId, 'Album');

    const patch: Partial<Album> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.hiddenFromTimeline !== undefined) patch.hiddenFromTimeline = dto.hiddenFromTimeline;

    if (Object.keys(patch).length === 0) {
      const count = await this.assets.countActiveInAlbum(id);
      return this.toDto(album, count);
    }

    await this.repo.update(id, patch);
    const updated = await this.repo.findOne({ where: { id } });
    const count = await this.assets.countActiveInAlbum(id);
    return this.toDto(updated!, count);
  }

  async delete(userId: string, id: string): Promise<void> {
    await findOwnedOr404(this.repo, id, userId, 'Album');
    // The baseline schema has no foreign keys, so the join rows are ours to
    // remove; orphans would outlive the album and resurface if an id were ever
    // reused, and they are what the mobile linker's 404 has to reason about.
    await this.albumAssetRepo.delete({ albumId: id });
    await this.repo.delete({ id, userId });
  }

  async addAssets(userId: string, albumId: string, assetIds: string[]): Promise<number> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album');

    const uniqueIds = [...new Set(assetIds)];
    const foundIds = await this.assets.ownedActiveIds(userId, uniqueIds);
    if (foundIds.size !== uniqueIds.length) {
      const missing = uniqueIds.find((id) => !foundIds.has(id));
      throw new NotFoundException(`Asset ${missing} not found`);
    }

    // Read the members first: the insert is `orIgnore`, so the response must report the rows this
    // request actually created, not the number of ids it was handed.
    const existing = await this.albumAssetRepo.find({
      select: { assetId: true },
      where: { albumId, assetId: In(uniqueIds) },
    });
    const alreadyMembers = new Set(existing.map((row) => row.assetId));
    const rows = uniqueIds
      .filter((assetId) => !alreadyMembers.has(assetId))
      .map((assetId) => ({ albumId, assetId }));
    if (rows.length === 0) return 0;

    await this.albumAssetRepo
      .createQueryBuilder()
      .insert()
      .into(AlbumAsset)
      .values(rows)
      .orIgnore()
      .execute();
    return rows.length;
  }

  async removeAsset(userId: string, albumId: string, assetId: string): Promise<void> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album');
    await this.albumAssetRepo.delete({ albumId, assetId });
  }

  async listAssets(
    userId: string,
    albumId: string,
    q: ListAlbumAssetsQueryDto,
  ): Promise<AssetListResponse> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album');

    const limit = q.limit;
    const offset = q.offset;
    // one continuation style per request: a cursor already encodes the position
    if (q.cursor && offset > 0) {
      throw apiError(400, 'VALIDATION_FAILED', 'offset must be 0 when cursor is provided', {
        details: [{ field: 'offset', message: 'offset must be 0 when cursor is provided' }],
      });
    }

    // `total` is the whole album count, not the remaining window: a cursor page reports the same
    // total the first page did
    const [{ assetIds, nextCursor }, total] = await Promise.all([
      pageAlbumAssetIds(this.albumAssetRepo, { albumId, limit, offset, cursor: q.cursor }),
      this.assets.countActiveInAlbum(albumId),
    ]);
    const items = await this.assets.listByIdsRanked(userId, assetIds);

    return { items, total, nextCursor };
  }

  private toDto(a: Album, assetCount: number): AlbumDto {
    return {
      id: a.id,
      userId: a.userId,
      name: a.name,
      description: a.description,
      hiddenFromTimeline: a.hiddenFromTimeline,
      assetCount,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
      updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt,
    };
  }
}
