import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { isUUID } from 'class-validator';
import { Asset } from '../database/entities';
import { AssetThumbnail } from '../database/entities';
import { FileRecord } from '../database/entities';
import { AlbumAsset } from '../database/entities/album-asset.entity';
import { Face } from '../database/entities';
import { findOwnedOr404 } from '../common/asset-ownership';
import { apiError } from '../common/api-error';
import { decodeCursor, encodeCursor, invalidCursor } from '../common/cursor';
import { isPostgresUniqueViolation } from '../common/sql-errors';
import { refreshPersonsAfterFaceDelete } from '../common/face-cleanup';
import { playableFileId } from './content-target';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { ListAssetsQueryDto } from './dto/list-assets-query.dto';
import { RegisterThumbnailDto } from './dto/register-thumbnail.dto';
import { WorkerMetadataDto } from '../worker/dto/worker-metadata.dto';
import { FacesService } from '../faces/faces.service';
import { PlacesResolveService } from '../places/places-resolve.service';
import { BullMqService } from '../queue/bullmq.service';
import type {
  Asset as AssetResponse,
  AssetLayoutIndex,
  AssetLayoutPage,
  AssetListResponse,
  AssetThumbnail as AssetThumbnailResponse,
} from '@photox/shared-types';

interface LayoutFilters {
  personId?: string;
  favorite?: boolean;
  albumId?: string;
}
interface LayoutRange {
  from: Date;
  to: Date;
  offset: number;
  limit: number;
}
interface WindowTouch {
  count: number;
  maxTouched: Date | string | null;
}
interface LayoutRow {
  t: Date | string;
  w: number;
  h: number;
}

interface AssetCursor {
  at: Date;
  uploadedAt: Date;
  id: string;
}

/** The last row's (effective date, uploadedAt, id) — the full list ORDER BY tuple. */
function encodeAssetCursor(asset: Asset): string {
  const at = asset.takenAt ?? asset.uploadedAt;
  return encodeCursor([at.toISOString(), asset.uploadedAt.toISOString(), asset.id]);
}

function decodeAssetCursor(raw: string): AssetCursor {
  const parts = decodeCursor(raw, 3);
  const at = new Date(parts[0] ?? '');
  const uploadedAt = new Date(parts[1] ?? '');
  const id = parts[2] ?? '';
  if (Number.isNaN(at.getTime()) || Number.isNaN(uploadedAt.getTime()) || !isUUID(id)) {
    invalidCursor();
  }
  return { at, uploadedAt, id };
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    @InjectRepository(Asset)
    private readonly repo: Repository<Asset>,
    @InjectRepository(AssetThumbnail)
    private readonly thumbRepo: Repository<AssetThumbnail>,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly dataSource: DataSource,
    private readonly facesService: FacesService,
    private readonly bullMq: BullMqService,
    private readonly places: PlacesResolveService,
  ) {}

  async create(userId: string, dto: CreateAssetDto): Promise<AssetResponse> {
    const asset = new Asset();
    asset.userId = userId;
    asset.fileId = dto.fileId;
    asset.kind = dto.kind;
    asset.title = dto.title ?? null;
    asset.description = dto.description ?? null;
    asset.takenAt = dto.takenAt ? new Date(dto.takenAt) : null;
    asset.mimeType = dto.mimeType ?? null;
    asset.sizeBytes = dto.sizeBytes ?? null;
    asset.originalName = dto.originalName ?? null;
    asset.transcodeStatus = dto.kind === 'video' ? 'pending' : null;
    asset.thumbnailStatus = 'pending';
    // P1-5: duplicate uploads converge on one file row. A second asset insert for the same
    // fileId collides on UNIQUE(fileId) — the file row is the user's content identity, so the
    // loser hands back the winner instead of failing an operation that already succeeded.
    let saved: Asset;
    try {
      saved = await this.repo.save(asset);
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        const existing = await this.repo.findOne({ where: { fileId: dto.fileId } });
        if (existing) return this.toResponse(existing);
      }
      throw err;
    }
    return this.toResponse(saved);
  }

  /**
   * The bytes behind `GET /api/v1/assets/:id/content`. The variant decision lives here so no client
   * has to know that a video's playable target is a derivative: `display` is the transcode when the
   * worker produced one, `original` is the uploaded bytes (downloads, "view original").
   *
   * A trashed asset has no content — 404 like a missing one, which also means the byte routes now
   * follow the asset's lifecycle instead of the file row's.
   */
  async contentTarget(
    userId: string,
    id: string,
    variant: 'display' | 'original',
  ): Promise<string> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');
    if (asset.isTrashed) throw new NotFoundException('Asset not found');
    if (variant === 'original') return asset.fileId;
    return playableFileId(this.fileRepo, userId, asset.transcodeFileId, asset.fileId);
  }

  async list(userId: string, q: ListAssetsQueryDto): Promise<AssetListResponse> {
    // ponytail: ids requests need every match (legacy re-embed ≤100/run); 100 mirrors the DTO @Max
    const limit = q.limit ?? (q.ids ? Math.min(q.ids.length, 100) : 20);
    const offset = q.offset ?? 0;
    const isTrashed = q.isTrashed ?? false;
    const cursor = q.cursor ? decodeAssetCursor(q.cursor) : null;
    // one continuation style per request: a cursor already encodes the position
    if (cursor && offset > 0) {
      throw apiError(400, 'VALIDATION_FAILED', 'offset must be 0 when cursor is provided', {
        details: [{ field: 'offset', message: 'offset must be 0 when cursor is provided' }],
      });
    }

    const baseQuery = (): SelectQueryBuilder<Asset> => {
      const qb = this.repo.createQueryBuilder('asset').where('asset.userId = :userId', { userId });

      qb.andWhere('asset.isTrashed = :isTrashed', { isTrashed });

      // the trash view must keep listing hidden-album assets so they can be restored or purged, and
      // id-batch reads (worker re-embed) are not timelines — only the browser timeline is filtered
      if (!isTrashed && !q.ids) this.applyHiddenAlbumFilter(qb, q.albumId);

      if (q.ids) {
        qb.andWhere('asset.id IN (:...ids)', { ids: q.ids });
      }

      if (q.dateFrom) {
        qb.andWhere('COALESCE(asset.takenAt, asset.uploadedAt) >= :dateFrom', {
          dateFrom: q.dateFrom,
        });
      }

      if (q.dateTo) {
        qb.andWhere('COALESCE(asset.takenAt, asset.uploadedAt) < :dateTo', { dateTo: q.dateTo });
      }

      if (q.favorite !== undefined) {
        qb.andWhere('asset.favorite = :favorite', { favorite: q.favorite });
      }

      if (q.hasLocations === true) {
        qb.andWhere('asset.latitude IS NOT NULL AND asset.longitude IS NOT NULL');
      } else if (q.hasLocations === false) {
        qb.andWhere('(asset.latitude IS NULL OR asset.longitude IS NULL)');
      }

      this.applyAssetFilters(qb, q);
      return qb;
    };

    // `total` is the whole match count, not the remaining window: a cursor page must report the
    // same total the first page did
    const total = await baseQuery().getCount();

    const qb = baseQuery()
      .orderBy(`COALESCE(asset.takenAt, asset.uploadedAt)`, 'DESC')
      .addOrderBy('asset.uploadedAt', 'DESC')
      // id completes the sort key, so a keyset cursor can compare the whole tuple
      .addOrderBy('asset.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      // keyset, not offset: a photo uploaded mid-scroll sorts above the cursor and cannot shift
      // the next page, so pages never repeat or skip a row
      qb.andWhere(
        `(COALESCE(asset.takenAt, asset.uploadedAt), asset.uploadedAt, asset.id) <
         (:cursorAt::timestamptz, :cursorUploadedAt::timestamptz, :cursorId::uuid)`,
        { cursorAt: cursor.at, cursorUploadedAt: cursor.uploadedAt, cursorId: cursor.id },
      );
    } else {
      qb.skip(offset);
    }

    const rows = await qb.getMany();
    const items = rows.length > limit ? rows.slice(0, limit) : rows;
    const thumbsByAsset = await this.fetchThumbs(items.map((a) => a.id));
    const last = items.at(-1);

    return {
      items: items.map((a) => this.toResponse(a, thumbsByAsset.get(a.id) ?? [])),
      total,
      nextCursor: rows.length > limit && last ? encodeAssetCursor(last) : null,
    };
  }

  /**
   * Fetch + serialize assets in the caller-provided id order (search fusion ranking), skipping
   * ids that are gone/trashed/foreign. Same wire shape as `list` via `toResponse`.
   */
  async listByIdsRanked(userId: string, ids: string[]): Promise<AssetResponse[]> {
    if (ids.length === 0) return [];
    const assets = await this.repo.find({ where: { id: In(ids), userId, isTrashed: false } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    const thumbsByAsset = await this.fetchThumbs(ids);
    return ids.flatMap((id) => {
      const asset = byId.get(id);
      return asset ? [this.toResponse(asset, thumbsByAsset.get(id) ?? [])] : [];
    });
  }

  async layout(
    userId: string,
    personId: string | undefined,
    favorite: boolean | undefined,
    albumId: string | undefined,
    range: LayoutRange,
  ): Promise<AssetLayoutPage> {
    const filters = { personId, favorite, albumId };
    const qb = this.repo
      .createQueryBuilder('asset')
      .select('COALESCE(asset.takenAt, asset.uploadedAt)', 't')
      .addSelect('COALESCE(asset.width, 1)', 'w')
      .addSelect('COALESCE(asset.height, 1)', 'h')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.isTrashed = :isTrashed', { isTrashed: false })
      .orderBy('COALESCE(asset.takenAt, asset.uploadedAt)', 'DESC')
      .addOrderBy('asset.uploadedAt', 'DESC');

    this.applyHiddenAlbumFilter(qb, albumId);

    this.applyAssetFilters(qb, filters);

    qb.andWhere('COALESCE(asset.takenAt, asset.uploadedAt) >= :from', { from: range.from })
      .andWhere('COALESCE(asset.takenAt, asset.uploadedAt) < :to', { to: range.to })
      // offset paging needs a total order: equal (timestamp, uploadedAt) rows otherwise page
      // non-deterministically and the walk would repeat or skip items
      .addOrderBy('asset.id', 'DESC')
      .offset(range.offset)
      .limit(range.limit);

    const [rows, stats] = await Promise.all([
      qb.getRawMany<LayoutRow>(),
      this.windowStats(userId, filters, range),
    ]);
    const items = rows.map(toLayoutItem);
    const walked = range.offset + items.length;
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      version: stats.version,
      total: stats.total,
      items,
      nextOffset: walked < stats.total ? walked : null,
    };
  }

  /**
   * Month index for the paged timeline: one window per local calendar month in `tz`, plus the
   * version the page endpoint must reproduce for each window. `tz` is validated here because
   * `Intl` (not class-validator) owns the timezone vocabulary.
   */
  async layoutMonths(
    userId: string,
    personId?: string,
    favorite?: boolean,
    albumId?: string,
    tz = 'UTC',
  ): Promise<AssetLayoutIndex> {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch (err) {
      if (err instanceof RangeError) throw new BadRequestException(`Invalid timezone: ${tz}`);
      throw err;
    }

    const filters = { personId, favorite, albumId };
    const month = `date_trunc('month', COALESCE(asset.takenAt, asset.uploadedAt) AT TIME ZONE :tz)`;
    const monthKey = `to_char(${month}, 'YYYY-MM')`;
    const qb = this.repo
      .createQueryBuilder('asset')
      .select(monthKey, 'key')
      .addSelect(`${month} AT TIME ZONE :tz`, 'from')
      // add the month to the local timestamp, then back to an instant: `timestamptz + interval`
      // would add it in the session zone and drift off the local month boundary
      .addSelect(`(${month} + interval '1 month') AT TIME ZONE :tz`, 'to')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(asset.updatedAt)', 'maxUpdatedAt')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.isTrashed = :isTrashed', { isTrashed: false })
      // `:tz` only appears in the select list and group-by, so it must be registered by hand
      .setParameters({ tz })
      .groupBy('1, 2, 3');

    this.applyHiddenAlbumFilter(qb, albumId);

    this.applyAssetFilters(qb, filters);

    const rows = await qb.getRawMany<{
      key: string;
      from: Date | string;
      to: Date | string;
      count: string;
      maxUpdatedAt: Date | string | null;
    }>();

    const touches =
      albumId || (await this.hasHiddenAlbum(userId))
        ? await this.windowTouches(userId, filters, { keySelect: monthKey, params: { tz } })
        : new Map<string, WindowTouch>();

    return {
      months: rows
        .map((r) => ({
          key: r.key,
          from: isoInstant(r.from),
          to: isoInstant(r.to),
          count: Number(r.count),
          version: this.windowVersion(
            Number(r.count),
            r.maxUpdatedAt,
            albumId ? null : (touches.get(r.key) ?? null),
            albumId ? (touches.get(r.key)?.maxTouched ?? null) : undefined,
          ),
        }))
        // from/to are monotonic in key, so a string sort is the window order
        .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)),
    };
  }

  async getOne(userId: string, id: string): Promise<AssetResponse> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');
    const faces = await this.facesService.getForAsset(asset.userId, id);
    const thumbRows = await this.thumbRepo.find({
      where: { assetId: id },
      order: { createdAt: 'ASC' },
    });
    return { ...this.toResponse(asset, thumbRows), faces };
  }

  async update(userId: string, id: string, dto: UpdateAssetDto): Promise<AssetResponse> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');

    const patch: Partial<Asset> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.takenAt !== undefined) patch.takenAt = dto.takenAt ? new Date(dto.takenAt) : null;
    if (dto.favorite !== undefined) patch.favorite = dto.favorite;

    if (Object.keys(patch).length === 0) {
      return this.toResponse(asset);
    }

    await this.repo.update(id, patch as Record<string, unknown>);
    const updated = await this.repo.findOne({ where: { id } });
    return this.toResponse(updated!);
  }

  async trash(userId: string, id: string): Promise<void> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');

    if (!asset.isTrashed) {
      await this.repo.update(id, { isTrashed: true, trashedAt: new Date() });
    }
  }

  async bulkTrash(userId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;
    await this.repo
      .createQueryBuilder()
      .update(Asset)
      .set({ isTrashed: true, trashedAt: new Date() })
      .where('id IN (:...assetIds) AND userId = :userId', { assetIds, userId })
      .execute();
  }

  async restore(userId: string, id: string): Promise<void> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');

    if (asset.isTrashed) {
      await this.repo.update(id, { isTrashed: false, trashedAt: null });
    }
  }

  async emptyTrash(userId: string): Promise<void> {
    const assets = await this.repo.find({
      where: { userId, isTrashed: true },
      select: { id: true },
    });
    if (assets.length === 0) return;
    await this.hardDelete(assets.map((a) => a.id));
  }

  async delete(userId: string, id: string): Promise<void> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');
    if (!asset.isTrashed)
      throw new BadRequestException('Asset must be trashed before permanent deletion');

    await this.hardDelete([id]);
  }

  private async hardDelete(assetIds: string[]): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      // C4: mirror FacesService.deleteForAsset — collect deleted face ids, null matching
      // person covers, and refresh live counts inside the same txn so hard-deleted assets
      // can't leave dangling coverFaceUrl thumbs behind.
      const existingFaces: Pick<Face, 'id' | 'personId'>[] = [];
      // bounded batches: one giant IN (...) list would exceed Postgres's 65,535 bind parameters
      for (let i = 0; i < assetIds.length; i += 500) {
        const batch = assetIds.slice(i, i + 500);
        // select only the cleanup keys: loading every 512-float embedding is hundreds of MB
        existingFaces.push(
          ...(await em.find(Face, {
            where: { assetId: In(batch) },
            select: { id: true, personId: true },
          })),
        );
        await em.delete(Face, { assetId: In(batch) });
        await em.delete(AlbumAsset, { assetId: In(batch) });
        // shares.assetId FK is ON DELETE CASCADE, so share rows fall with the asset
        await em.delete(Asset, { id: In(batch) });
      }
      await refreshPersonsAfterFaceDelete(em, existingFaces);
    });
  }

  async updateMetadata(id: string, userId: string, dto: WorkerMetadataDto): Promise<AssetResponse> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');
    // phash is a plain column (spread maps it), but its format is semantic -> 422 like embeddings
    if (dto.phash !== undefined && dto.phash !== null && !/^[0-9a-f]{16}$/.test(dto.phash)) {
      throw new UnprocessableEntityException('phash must be 16 lowercase hex characters');
    }

    // every DTO field except `status`/`transcodeFileId`/`thumbnailStatus` maps 1:1 to an Asset
    // column; TypeORM skips undefined values, so absent fields stay untouched
    const { status, transcodeFileId, thumbnailStatus, ...fields } = dto;
    const patch: Partial<Asset> = { ...fields };
    if (thumbnailStatus === 'ready' || thumbnailStatus === 'failed') {
      // ponytail: the 4 size jobs race, so derive the verdict from committed thumbnail rows
      // instead of trusting the last caller: no false ready, no failure flipping a full set
      await this.repo
        .createQueryBuilder()
        .update(Asset)
        .set({ thumbnailStatus })
        .where('id = :id AND "userId" = :userId', { id, userId })
        .andWhere(
          `(SELECT COUNT(DISTINCT size) FROM asset_thumbnails WHERE "assetId" = :id) ${
            thumbnailStatus === 'ready' ? '>=' : '<'
          } 4`,
          { id },
        )
        .execute();
    } else if (thumbnailStatus !== undefined) {
      patch.thumbnailStatus = thumbnailStatus;
    }
    if (status !== undefined) {
      patch.metadataStatus = status;
      patch.metadataExtractedAt = new Date();
    }
    if (transcodeFileId !== undefined) {
      if (transcodeFileId === null) {
        patch.transcodeFileId = null;
      } else {
        if (!isUUID(transcodeFileId)) {
          throw new UnprocessableEntityException('transcodeFileId must be a UUID');
        }
        const file = await this.fileRepo.findOne({ where: { id: transcodeFileId } });
        // missing and foreign files are indistinguishable, like every other ownership check
        if (file?.userId !== asset.userId) throw new NotFoundException('File not found');
        patch.transcodeFileId = transcodeFileId;
      }
    }

    // resolve place once, when this write brings real coordinates and no city was resolved yet
    // (typeof+isFinite: class-validator @IsOptional passes null through, and the worker sends
    // latitude/longitude: null for every photo without GPS)
    if (
      asset.placeCity === null &&
      typeof fields.latitude === 'number' &&
      Number.isFinite(fields.latitude) &&
      typeof fields.longitude === 'number' &&
      Number.isFinite(fields.longitude)
    ) {
      try {
        // ponytail: per-write nearest-city lookup (indexed KNN); precompute/materialize per
        // coordinate cell if it ever shows in slow-query logs
        const place = await this.places.resolve(fields.latitude, fields.longitude);
        if (place) Object.assign(patch, place);
      } catch {
        // geocoding must never fail a metadata write
        this.logger.warn(`place resolution failed for asset ${id}`);
      }
    }

    // the conditional thumbnail update above already wrote its own column; skip an empty patch
    // (TypeORM throws on an update with no values, and the worker's ready/failed PATCH sends
    // only thumbnailStatus)
    if (Object.keys(patch).length > 0) {
      await this.repo.update(id, patch as Record<string, unknown>);
    }
    const updated = await this.repo.findOne({ where: { id } });
    return this.toResponse(updated!);
  }

  async reprocessThumbnails(userId: string, id: string): Promise<{ enqueued: number }> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');
    const ok = await this.bullMq.enqueueThumbnails(
      asset.id,
      asset.fileId,
      asset.userId,
      'thumb-reprocess',
    );
    if (!ok) throw new ServiceUnavailableException('Failed to enqueue thumbnail reprocess jobs');
    return { enqueued: 4 };
  }

  async reprocessVideo(userId: string, id: string): Promise<{ enqueued: number }> {
    const asset = await findOwnedOr404(this.repo, id, userId, 'Asset');
    if (asset.kind !== 'video') throw new BadRequestException('Not a video asset');
    const ok = await this.bullMq.enqueueVideo(asset.id, asset.fileId, asset.userId, {
      reprocess: true,
    });
    if (!ok) throw new ServiceUnavailableException('Failed to enqueue video reprocess job');
    return { enqueued: 1 };
  }

  async registerThumbnail(
    userId: string,
    assetId: string,
    dto: RegisterThumbnailDto,
  ): Promise<AssetThumbnailResponse> {
    const asset = await findOwnedOr404(this.repo, assetId, userId, 'Asset');
    const file = await this.fileRepo.findOne({ where: { id: dto.fileId } });
    if (!file) throw new NotFoundException('File not found');
    // a thumbnail row pointing at another user's bytes would leak it through share streams
    if (file.userId !== asset.userId) {
      throw new UnprocessableEntityException('Thumbnail file must belong to the asset owner');
    }
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
    );
    const row = await this.thumbRepo.findOneOrFail({ where: { assetId, size: dto.size } });
    return toThumbnailResponse(row);
  }

  /** One window's `total` + `version`, with the same predicates as the page query itself. */
  private async windowStats(
    userId: string,
    filters: LayoutFilters,
    range: { from: Date; to: Date },
  ): Promise<{ total: number; version: string }> {
    const qb = this.repo
      .createQueryBuilder('asset')
      .select('COUNT(*)', 'count')
      .addSelect('MAX(asset.updatedAt)', 'maxUpdatedAt')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.isTrashed = :isTrashed', { isTrashed: false })
      .andWhere('COALESCE(asset.takenAt, asset.uploadedAt) >= :from', { from: range.from })
      .andWhere('COALESCE(asset.takenAt, asset.uploadedAt) < :to', { to: range.to });

    this.applyHiddenAlbumFilter(qb, filters.albumId);

    this.applyAssetFilters(qb, filters);

    const row = await qb.getRawOne<{ count: string; maxUpdatedAt: Date | string | null }>();
    const total = Number(row?.count ?? 0);
    const touch =
      filters.albumId || (await this.hasHiddenAlbum(userId))
        ? await this.windowTouches(userId, filters, { keySelect: `''`, range })
        : null;
    // the index groups by month and reads the same per-window counters by key
    const window = touch?.values().next().value ?? null;
    return {
      total,
      version: this.windowVersion(
        total,
        row?.maxUpdatedAt ?? null,
        filters.albumId ? null : window,
        filters.albumId ? (window?.maxTouched ?? null) : undefined,
      ),
    };
  }

  /**
   * Version components for one window. `count`/`maxUpdatedAt` cover the visible matching set;
   * hidden-album membership is folded in separately because hiding or joining an album never
   * bumps `assets.updatedAt`. `albumId` views bypass the hidden filter, so they track membership
   * through `albumMaxAddedMs` instead (removals already move `count`).
   */
  private windowVersion(
    count: number,
    maxUpdatedAt: Date | string | null,
    hidden: WindowTouch | null,
    albumMaxAdded?: Date | string | null,
  ): string {
    const parts = [
      count,
      toEpochMs(maxUpdatedAt),
      hidden?.count ?? 0,
      toEpochMs(hidden?.maxTouched),
    ];
    if (albumMaxAdded !== undefined) parts.push(toEpochMs(albumMaxAdded));
    return parts.join('-');
  }

  /**
   * Hidden-album touch counters, or album-membership ones for `albumId` views. The index groups
   * them by month key; the window page passes a range and reads the single row. Person/favourite
   * filters are deliberately not applied: a spurious version bump costs one refetch, a missed one
   * would keep a stale window cached.
   */
  private async windowTouches(
    userId: string,
    filters: LayoutFilters,
    window: {
      keySelect: string;
      params?: Record<string, unknown>;
      range?: { from: Date; to: Date };
    },
  ): Promise<Map<string, WindowTouch>> {
    const qb = this.repo
      .createQueryBuilder('asset')
      .select(window.keySelect, 'key')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.isTrashed = :isTrashed', { isTrashed: false });

    if (filters.albumId) {
      qb.addSelect('MAX(aa."addedAt")', 'maxTouched')
        .innerJoin('album_assets', 'aa', 'aa."assetId" = asset.id')
        .andWhere('aa."albumId" = :albumId', { albumId: filters.albumId });
    } else {
      qb.addSelect('COUNT(*)', 'count')
        .addSelect('MAX(GREATEST(al."updatedAt", aa."addedAt"))', 'maxTouched')
        .innerJoin('album_assets', 'aa', 'aa."assetId" = asset.id')
        .innerJoin('albums', 'al', 'al.id = aa."albumId"')
        .andWhere('al."hiddenFromTimeline"')
        .andWhere('al."userId" = :userId');
    }

    const range = window.range;
    if (range) {
      qb.andWhere('COALESCE(asset.takenAt, asset.uploadedAt) >= :from', {
        from: range.from,
      }).andWhere('COALESCE(asset.takenAt, asset.uploadedAt) < :to', { to: range.to });
    } else {
      qb.groupBy('1');
    }
    if (window.params) qb.setParameters(window.params);

    const rows = await qb.getRawMany<{
      key: string;
      count?: string;
      maxTouched: Date | string | null;
    }>();
    return new Map(
      rows.map((r) => [r.key, { count: Number(r.count ?? 0), maxTouched: r.maxTouched ?? null }]),
    );
  }

  /** A user without a hidden album skips the per-window hidden aggregate entirely. */
  private async hasHiddenAlbum(userId: string): Promise<boolean> {
    const rows: unknown[] = await this.repo.query(
      'SELECT 1 FROM albums WHERE "userId" = $1 AND "hiddenFromTimeline" LIMIT 1',
      [userId],
    );
    return rows.length > 0;
  }

  private applyAssetFilters(
    qb: SelectQueryBuilder<Asset>,
    filters: { personId?: string; favorite?: boolean; albumId?: string },
  ): void {
    if (filters.personId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM faces f WHERE f."assetId" = asset.id AND f."personId" = :personId)',
        { personId: filters.personId },
      );
    }

    if (filters.favorite !== undefined) {
      qb.andWhere('asset.favorite = :favorite', { favorite: filters.favorite });
    }

    if (filters.albumId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM album_assets aa WHERE aa."assetId" = asset.id AND aa."albumId" = :albumId)',
        { albumId: filters.albumId },
      );
    }
  }

  /**
   * Timeline rule: an asset is on the timeline only when none of its albums is hidden. Skipped for
   * explicit album views, which must keep listing a hidden album's assets.
   */
  private applyHiddenAlbumFilter(qb: SelectQueryBuilder<Asset>, albumId?: string): void {
    if (albumId) return;
    qb.andWhere(
      `NOT EXISTS (SELECT 1 FROM album_assets aa JOIN albums al ON al.id = aa."albumId" WHERE aa."assetId" = asset.id AND al."userId" = :userId AND al."hiddenFromTimeline")`,
    );
  }

  private async fetchThumbs(assetIds: string[]): Promise<Map<string, AssetThumbnail[]>> {
    const byAsset = new Map<string, AssetThumbnail[]>();
    if (assetIds.length === 0) return byAsset;
    const rows = await this.thumbRepo.find({
      where: { assetId: In(assetIds) },
      order: { createdAt: 'ASC' },
    });
    for (const row of rows) {
      const list = byAsset.get(row.assetId) ?? [];
      list.push(row);
      byAsset.set(row.assetId, list);
    }
    return byAsset;
  }

  private toResponse(asset: Asset, thumbnails?: AssetThumbnail[]): AssetResponse {
    const {
      placeCity,
      placeAdmin1,
      placeCountryCode,
      placeTimezone,
      placeDistanceKm,
      phash,
      embeddingStatus,
      updatedAt,
      thumbnails: _thumbnails,
      ...wire
    } = asset;
    // non-wire columns are destructured out so the rest spread is exactly the wire projection
    void [
      placeCity,
      placeAdmin1,
      placeCountryCode,
      placeTimezone,
      placeDistanceKm,
      phash,
      embeddingStatus,
      updatedAt,
      _thumbnails,
    ];
    return {
      ...wire,
      contentVersion: asset.transcodeFileId ?? asset.fileId,
      uploadedAt:
        asset.uploadedAt instanceof Date ? asset.uploadedAt.toISOString() : asset.uploadedAt,
      trashedAt: asset.trashedAt instanceof Date ? asset.trashedAt.toISOString() : null,
      takenAt: asset.takenAt instanceof Date ? asset.takenAt.toISOString() : null,
      sizeBytes: asset.sizeBytes !== null ? Number(asset.sizeBytes) : null,
      durationSeconds: asset.durationSeconds !== null ? Number(asset.durationSeconds) : null,
      fNumber: asset.fNumber !== null ? Number(asset.fNumber) : null,
      exposureTime: asset.exposureTime !== null ? Number(asset.exposureTime) : null,
      focalLength: asset.focalLength !== null ? Number(asset.focalLength) : null,
      latitude: asset.latitude !== null ? Number(asset.latitude) : null,
      longitude: asset.longitude !== null ? Number(asset.longitude) : null,
      altitude: asset.altitude !== null ? Number(asset.altitude) : null,
      fps: asset.fps !== null ? Number(asset.fps) : null,
      metadataExtractedAt:
        asset.metadataExtractedAt instanceof Date ? asset.metadataExtractedAt.toISOString() : null,
      ...(thumbnails ? { thumbnails: thumbnails.map((t) => toThumbnailResponse(t)) } : {}),
    };
  }
}

// pg unique-violation probe shared by the upload-race arbiters (user-files + assets create).
function toThumbnailResponse(t: AssetThumbnail): AssetThumbnailResponse {
  return {
    size: t.size,
    fileId: t.fileId,
    width: t.width,
    height: t.height,
    bytes: Number(t.bytes),
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  };
}

function toLayoutItem(row: LayoutRow): { t: string; w: number; h: number } {
  return { t: isoInstant(row.t), w: Number(row.w), h: Number(row.h) };
}

// pg hands timestamptz back as Date; raw query output can also arrive as a string
function isoInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toEpochMs(value: Date | string | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}
