import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import sharp from 'sharp';
import { Face } from '../database/entities';
import { Person } from '../database/entities';
import { Asset } from '../database/entities';
import { AssetThumbnail } from '../database/entities';
import { FileRecord } from '../database/entities';
import { findOwnedOr404 } from '../common/asset-ownership';
import { refreshPersonsAfterFaceDelete } from '../common/face-cleanup';
import { LocalStorageService } from '@photox/shared-config';
import { refreshPersonFaceCount } from './face-count';
import type { DetectedFaceInput, FaceDto } from '@photox/shared-types';

const DEFAULT_SIZE = 240;
const MAX_SIZE = 600;

function toFaceDto(f: Face, includeEmbeddings = false) {
  return {
    id: f.id,
    assetId: f.assetId,
    box: f.box,
    confidence: f.confidence,
    personId: f.personId ?? null,
    ...(includeEmbeddings ? { embedding: f.embedding } : {}),
  };
}

@Injectable()
export class FacesService {
  constructor(
    @InjectRepository(Face)
    private readonly repo: Repository<Face>,
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AssetThumbnail)
    private readonly thumbRepo: Repository<AssetThumbnail>,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly dataSource: DataSource,
    private readonly storage: LocalStorageService,
  ) {}

  async registerFaces(
    assetId: string,
    userId: string,
    faces: DetectedFaceInput[],
  ): Promise<{ count: number }> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset');
    const entities = faces.map((f) => {
      const face = new Face();
      face.assetId = assetId;
      face.userId = userId;
      face.box = f.box;
      face.confidence = f.confidence;
      face.embedding = f.embedding;
      return face;
    });
    await this.repo.save(entities);
    return { count: entities.length };
  }

  // ponytail: transactional companion to registerFaces — worker re-embed does DELETE then POST,
  // so a retry never duplicates stale rows
  async deleteForAsset(userId: string, assetId: string): Promise<{ deleted: number }> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset');
    return this.dataSource.transaction(async (em) => {
      const existing = await em.find(Face, { where: { assetId, userId } });
      if (existing.length === 0) return { deleted: 0 };

      await em.delete(Face, { assetId, userId });
      await refreshPersonsAfterFaceDelete(em, existing, userId);
      return { deleted: existing.length };
    });
  }

  async getForAsset(userId: string, assetId: string): Promise<FaceDto[]> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset');
    const faces = await this.repo.find({ where: { assetId } });
    return faces.map((f) => toFaceDto(f));
  }

  // ponytail: keyset page over (userId, id ASC); trashed filtered in memory —
  // pages can run short when trashed rows dominate; join-filter if that ever matters.
  async listForUserPaginated(
    userId: string,
    opts: {
      limit?: number;
      cursor?: string;
      includeEmbeddings?: boolean;
      excludeTrashed?: boolean;
    },
  ) {
    const limit = opts.limit ?? 500;
    const faces = await this.repo.find({
      where: { userId, ...(opts.cursor ? { id: MoreThan(opts.cursor) } : {}) },
      order: { id: 'ASC' },
      take: limit,
    });
    const trashedAssetIds = await this.trashedAssetIds(userId, opts.excludeTrashed);
    const items = faces
      .filter((f) => !trashedAssetIds?.has(f.assetId))
      .map((f) => toFaceDto(f, opts.includeEmbeddings));
    return { items, nextCursor: faces.length < limit ? null : (faces.at(-1)?.id ?? null) };
  }

  private async trashedAssetIds(
    userId: string,
    excludeTrashed?: boolean,
  ): Promise<Set<string> | null> {
    if (!excludeTrashed) return null;
    const trashed = await this.assetRepo.find({
      where: { userId, isTrashed: true },
      select: { id: true },
    });
    return new Set(trashed.map((a) => a.id));
  }

  async assignPerson(userId: string, faceId: string, personId: string | null): Promise<void> {
    const face = await findOwnedOr404(this.repo, faceId, userId, 'Face');
    if (personId) {
      await findOwnedOr404(this.personRepo, personId, userId, 'Person');
    }
    const oldPersonId = face.personId;
    face.personId = personId;
    await this.repo.save(face);
    // ponytail: keep Person.faceCount in sync after assign/unassign (cluster job + manual edits both route here)
    if (oldPersonId) await refreshPersonFaceCount(this.repo, this.personRepo, oldPersonId, userId);
    if (personId) await refreshPersonFaceCount(this.repo, this.personRepo, personId, userId);
  }

  // ponytail: synchronous crop on demand. Caching the resulting jpeg (e.g. via a `face_thumbs` table or local disk) is the upgrade path when traffic warrants.
  // single-flight map keyed by owner too: a non-owner request must run its own findOwnedOr404 (404s, never rides the owner's promise)
  private readonly inflight = new Map<string, Promise<Buffer>>();

  async getThumb(faceId: string, userId: string, size: number): Promise<Buffer> {
    const target = Math.max(
      32,
      Math.min(MAX_SIZE, Math.floor(Number.isFinite(size) ? size : DEFAULT_SIZE)),
    );
    const key = `${userId}:${faceId}:${target}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const job = this.renderThumb(faceId, userId, target).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async renderThumb(faceId: string, userId: string, target: number): Promise<Buffer> {
    const face = await findOwnedOr404(this.repo, faceId, userId, 'Face');
    const asset = await findOwnedOr404(this.assetRepo, face.assetId, userId, 'Asset');
    const src = await this.resolveThumbSource(asset, userId);
    const box = {
      x: face.box.x * src.scaleX,
      y: face.box.y * src.scaleY,
      w: face.box.w * src.scaleX,
      h: face.box.h * src.scaleY,
    };

    const pad = 0.35;
    const left = Math.max(0, Math.floor(box.x - box.w * pad));
    const top = Math.max(0, Math.floor(box.y - box.h * pad));
    const width = Math.min(src.sourceW - left, Math.ceil(box.w * (1 + pad * 2)));
    const height = Math.min(src.sourceH - top, Math.ceil(box.h * (1 + pad * 2)));
    if (width <= 0 || height <= 0) throw new NotFoundException('Face box out of bounds');

    let pipeline = sharp(src.path);
    // .rotate() runs before .extract() regardless of chain order and is a no-op at orientation 1
    if (src.applyRotate) pipeline = pipeline.rotate();
    return pipeline
      .extract({ left, top, width, height })
      .resize({ width: target, height: target, fit: 'cover' })
      .jpeg({ quality: 82 })
      .toBuffer();
  }

  // `face.box` lives in oriented-original pixel space; the xl derivative is already oriented,
  // so its coords scale directly. The original fallback re-derives oriented dims from EXIF.
  private async resolveThumbSource(
    asset: Asset,
    userId: string,
  ): Promise<{
    path: string;
    sourceW: number;
    sourceH: number;
    scaleX: number;
    scaleY: number;
    applyRotate: boolean;
  }> {
    // asset.width/height are oriented dims; without them there is nothing to scale box coords from
    if (asset.width && asset.height) {
      const xl = await this.thumbRepo.findOne({ where: { assetId: asset.id, size: 'xl' } });
      const file = xl ? await this.fileRepo.findOne({ where: { id: xl.fileId, userId } }) : null;
      if (xl && file) {
        return {
          path: this.storage.pathFor(file.storageKey),
          sourceW: xl.width,
          sourceH: xl.height,
          scaleX: xl.width / asset.width,
          scaleY: xl.height / asset.height,
          applyRotate: false,
        };
      }
    }

    const file = await findOwnedOr404(this.fileRepo, asset.fileId, userId, 'File');
    const path = this.storage.pathFor(file.storageKey);
    const meta = await sharp(path).metadata();
    const swapped = (meta.orientation ?? 1) >= 5;
    const w = swapped ? meta.height : meta.width;
    const h = swapped ? meta.width : meta.height;
    if (!w || !h) throw new NotFoundException('Source image unreadable');
    return { path, sourceW: w, sourceH: h, scaleX: 1, scaleY: 1, applyRotate: swapped };
  }
}
