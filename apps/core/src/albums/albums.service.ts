import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isUUID } from 'class-validator';
import { Album } from './entities/album.entity';
import { AlbumAsset } from './entities/album-asset.entity';
import { Asset } from '../database/entities';
import { findOwnedOr404 } from '../common/asset-ownership';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { ListAlbumAssetsQueryDto } from './dto/list-album-assets-query.dto';
import { PaginationQueryDto } from '../common/pagination-query.dto';
import { AssetsService } from '../assets/assets.service';
import type { AlbumDto, Asset as AssetResponse } from '@photox/shared-types';

interface AlbumAssetCursor {
  addedAt: Date;
  assetId: string;
}

/** The last row's ("addedAt", "assetId") — the full album-assets ORDER BY tuple. */
function encodeAlbumAssetCursor(row: { addedAt: Date | string; assetId: string }): string {
  return Buffer.from(JSON.stringify([new Date(row.addedAt).toISOString(), row.assetId])).toString(
    'base64url',
  );
}

function decodeAlbumAssetCursor(raw: string): AlbumAssetCursor {
  const invalid = (): BadRequestException => new BadRequestException('Invalid cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid();
  const [addedAt, assetId] = parsed as unknown[];
  if (typeof addedAt !== 'string' || typeof assetId !== 'string') throw invalid();
  const addedAtDate = new Date(addedAt);
  if (Number.isNaN(addedAtDate.getTime()) || !isUUID(assetId)) throw invalid();
  return { addedAt: addedAtDate, assetId };
}

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
    const album = new Album();
    album.userId = userId;
    album.name = dto.name;
    album.description = dto.description ?? null;
    album.hiddenFromTimeline = dto.hiddenFromTimeline ?? false;
    const saved = await this.repo.save(album);
    return this.toDto(saved, 0);
  }

  async list(userId: string, q: PaginationQueryDto): Promise<{ items: AlbumDto[]; total: number }> {
    const limit = q.limit;
    const offset = q.offset;

    const [items, total] = await this.repo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
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

    const count = await this.countAssets(id);
    return this.toDto(album, count);
  }

  async update(userId: string, id: string, dto: UpdateAlbumDto): Promise<AlbumDto> {
    const album = await findOwnedOr404(this.repo, id, userId, 'Album');

    const patch: Partial<Album> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.hiddenFromTimeline !== undefined) patch.hiddenFromTimeline = dto.hiddenFromTimeline;

    if (Object.keys(patch).length === 0) {
      const count = await this.countAssets(id);
      return this.toDto(album, count);
    }

    await this.repo.update(id, patch);
    const updated = await this.repo.findOne({ where: { id } });
    const count = await this.countAssets(id);
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

  async addAssets(userId: string, albumId: string, assetIds: string[]): Promise<void> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album');

    const uniqueIds = [...new Set(assetIds)];
    const found = await this.assetRepo.find({
      where: { id: In(uniqueIds), userId, isTrashed: false },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      const foundIds = new Set(found.map((a) => a.id));
      const missing = uniqueIds.find((id) => !foundIds.has(id));
      throw new NotFoundException(`Asset ${missing} not found`);
    }

    const rows = assetIds.map((assetId) => ({ albumId, assetId }));

    await this.albumAssetRepo
      .createQueryBuilder()
      .insert()
      .into(AlbumAsset)
      .values(rows)
      .orIgnore()
      .execute();
  }

  async removeAsset(userId: string, albumId: string, assetId: string): Promise<void> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album');
    await this.albumAssetRepo.delete({ albumId, assetId });
  }

  async listAssets(
    userId: string,
    albumId: string,
    q: ListAlbumAssetsQueryDto,
  ): Promise<{ items: AssetResponse[]; total: number; nextCursor: string | null }> {
    await findOwnedOr404(this.repo, albumId, userId, 'Album');

    const limit = q.limit;
    const offset = q.offset;
    const cursor = q.cursor ? decodeAlbumAssetCursor(q.cursor) : null;

    const qb = this.albumAssetRepo
      .createQueryBuilder('aa')
      .select('aa.assetId', 'assetId')
      .addSelect('aa.addedAt', 'addedAt')
      .innerJoin('assets', 'asset', 'asset.id = aa."assetId"')
      .where('aa.albumId = :albumId', { albumId })
      .andWhere('asset.isTrashed = false')
      .orderBy('aa.addedAt', 'DESC')
      // id completes the sort key, so a keyset cursor can compare the whole tuple
      .addOrderBy('aa.assetId', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      // keyset, not offset: a bulk add mid-scroll shares one addedAt, so offset pages would
      // repeat or skip rows. A cursor alongside an offset wins; the offset is ignored.
      qb.andWhere(
        '(aa."addedAt", aa."assetId") < (:cursorAddedAt::timestamptz, :cursorAssetId::uuid)',
        { cursorAddedAt: cursor.addedAt, cursorAssetId: cursor.assetId },
      );
    } else {
      qb.offset(offset);
    }

    // `total` is the whole album count, not the remaining window: a cursor page reports the same
    // total the first page did
    const total = await this.countAssets(albumId);

    const rows = await qb.getRawMany<{ assetId: string; addedAt: Date | string }>();
    const page = rows.slice(0, limit);
    const items = await this.assets.listByIdsRanked(
      userId,
      page.map((j) => j.assetId),
    );
    const last = page.at(-1);

    return {
      items,
      total,
      nextCursor: rows.length > limit && last ? encodeAlbumAssetCursor(last) : null,
    };
  }

  private async countAssets(albumId: string): Promise<number> {
    const result = await this.assetRepo
      .createQueryBuilder('a')
      .innerJoin('album_assets', 'aa', 'aa."assetId" = a.id')
      .where('aa."albumId" = :albumId', { albumId })
      .andWhere('a.isTrashed = false')
      .getCount();
    return result;
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
