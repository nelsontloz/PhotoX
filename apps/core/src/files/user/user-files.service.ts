import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, FindOptionsWhere } from 'typeorm';
import { isUUID } from 'class-validator';
import { randomUUID, createHash } from 'crypto';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { extname } from 'path';
import { pipeline } from 'stream/promises';
import { Asset, FileRecord } from '../../database/entities';
import { loadEnv, LocalStorageService } from '@photox/shared-config';
import { findOwnedOr404 } from '../../common/asset-ownership';
import { kindFromMime, sniffMime } from '../../common/mime';
import { ingestErrorBody } from '../../common/ingest-errors';
import { RegisterFileBodyDto } from './dto/register-file.body.dto';
import type { UploadFileBodyDto } from './dto/upload-file.body.dto';
import { FileRecordDto } from '../file-record.dto';
import { AssetsService } from '../../assets/assets.service';
import { BullMqService } from '../../queue/bullmq.service';
import type {
  Asset as AssetResponse,
  FileExistsCheckHit,
  StorageQuotaResponse,
} from '@photox/shared-types';

// the subset persistOriginal needs: bytes on disk plus the display name/size for the row.
// mimetype is deliberately absent — the sniffer is authoritative.
export interface OriginalFileInput {
  path: string;
  originalname: string;
  size: number;
}

// meta accepted by createAssetAndEnqueue — title/description/takenAt plus the file-derived
// originalName/sizeBytes the asset row records
export interface AssetUploadMeta {
  title?: string;
  description?: string;
  takenAt?: string;
  originalName: string;
  sizeBytes: number;
}


@Injectable()
export class UserFilesService {
  private readonly logger = new Logger(UserFilesService.name);

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly storage: LocalStorageService,
    private readonly assets: AssetsService,
    private readonly bullMq: BullMqService,
  ) {}

  async upload(
    userId: string,
    file: OriginalFileInput,
    meta: UploadFileBodyDto = {},
  ): Promise<{ asset: AssetResponse; created: boolean }> {
    const name = file?.originalname;
    this.logger.log(
      `[UserFilesService] upload started user=${userId} name=${name} size=${file?.size}`,
    );
    try {
      const { record, created } = await this.persistOriginal(userId, file);
      // C2-narrowed: the pipeline kind is derived solely from the sniffed mime, so JPEG bytes
      // with a mislabelled mime can't enter the video pipeline.
      const kind = kindFromMime(record.mimeType);
      if (!kind) {
        throw new BadRequestException(
          ingestErrorBody(400, 'Unsupported file type', 'UNSUPPORTED_TYPE'),
        );
      }
      this.logger.log(
        `[UserFilesService] file saved user=${userId} file=${record.id} deduplicated=${!created}`,
      );
      const asset = await this.createAssetAndEnqueue(userId, record, kind, {
        title: meta.title,
        description: meta.description,
        takenAt: meta.takenAt,
        originalName: file.originalname,
        sizeBytes: file.size,
      });
      this.logger.log(`[UserFilesService] upload finished user=${userId} asset=${asset.id}`);
      // `created` is the durable-bytes flag, not the asset flag: a re-linking upload of owned
      // bytes answers 200 with its (possibly pre-existing) asset.
      return { asset, created };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[UserFilesService] upload failed user=${userId} name=${name}: ${message}`);
      throw err;
    }
  }

  // shared by legacy upload and upload-session complete: create the asset row, then enqueue its
  // processing jobs. The two halves are separately public so a complete() whose enqueues failed
  // can persist the asset id and re-run only the enqueue half on retry.
  async createAssetAndEnqueue(
    userId: string,
    record: FileRecord,
    kind: 'photo' | 'video',
    meta: AssetUploadMeta,
  ): Promise<AssetResponse> {
    const asset = await this.createAsset(userId, record, kind, meta);
    await this.enqueueAssetJobs(userId, record, kind, asset.id);
    return asset;
  }

  /** Asset row only — no jobs. Callers must follow with enqueueAssetJobs for a usable asset. */
  async createAsset(
    userId: string,
    record: FileRecord,
    kind: 'photo' | 'video',
    meta: AssetUploadMeta,
  ): Promise<AssetResponse> {
    return this.assets.create(userId, {
      fileId: record.id,
      kind,
      title: meta.title,
      description: meta.description,
      takenAt: meta.takenAt,
      mimeType: record.mimeType,
      sizeBytes: meta.sizeBytes,
      originalName: meta.originalName,
    });
  }

  /**
   * Every job the asset needs, awaited. `file` only supplies the fileId — the retry half of an
   * upload session has the id but no loaded FileRecord. Throws 503 when any enqueue failed.
   */
  async enqueueAssetJobs(
    userId: string,
    file: Pick<FileRecord, 'id'>,
    kind: 'photo' | 'video',
    assetId: string,
  ): Promise<void> {
    // P0-3: every enqueue is awaited and a single Redis loss fails the upload — the rows
    // already exist, but a silent 201 would orphan them with no job ever coming
    const enqueues: Promise<boolean>[] = [
      this.bullMq.enqueueThumbnails(assetId, file.id, userId),
      this.bullMq.enqueue('process-metadata', 'process-metadata', {
        assetId,
        fileId: file.id,
        userId,
        kind,
      }),
    ];
    if (kind === 'photo') {
      enqueues.push(
        this.bullMq.enqueue('process-faces', 'process-faces', {
          assetId,
          fileId: file.id,
          userId,
        }),
        // videos out of scope for vision search — only photos get image embeddings
        this.bullMq.enqueueAssetJob('embed', assetId, file.id, userId),
        this.bullMq.enqueueAssetJob('detect', assetId, file.id, userId),
      );
    } else {
      enqueues.push(this.bullMq.enqueueVideo(assetId, file.id, userId));
    }
    if ((await Promise.all(enqueues)).includes(false)) {
      throw new ServiceUnavailableException('Failed to enqueue background processing jobs');
    }
  }

  // ponytail: workers write bytes first, then register the row; core recomputes the
  // storageKey from (kind, user, id, ext) so a client can never point at another user's bytes
  async register(
    userId: string,
    dto: RegisterFileBodyDto,
  ): Promise<{ file: FileRecordDto; created: boolean }> {
    const purpose = dto.kind === 'transcode' ? 'transcode' : 'original';
    const naturalKey: FindOptionsWhere<FileRecord> = {
      userId,
      checksumSha256: dto.checksumSha256,
      purpose,
      ...(dto.assetId ? { assetId: dto.assetId } : {}),
    };
    const existing = await this.fileRepo.findOne({ where: naturalKey });
    if (existing) return { file: FileRecordDto.from(existing), created: false };

    if (await this.fileRepo.exists({ where: { id: dto.id } })) {
      throw new ConflictException('File id already exists');
    }

    if (dto.assetId) {
      await findOwnedOr404(this.assetRepo, dto.assetId, userId, 'Asset');
    }

    const storageKey = this.storage.buildKey(dto.kind, userId, dto.id, dto.ext);
    if (!(await this.storage.exists(storageKey))) {
      throw new UnprocessableEntityException('File bytes not found in storage');
    }

    // P1-5: same ON CONFLICT DO NOTHING arbiter as persistOriginal — concurrent registers of
    // identical bytes both pass the checks above; the partial unique index decides.
    await this.fileRepo
      .createQueryBuilder()
      .insert()
      .values({
        id: dto.id,
        userId,
        storageKey,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        checksumSha256: dto.checksumSha256,
        purpose,
        assetId: dto.assetId ?? null,
      })
      .orIgnore()
      .execute();

    const row = await this.fileRepo.findOne({ where: { id: dto.id } });
    if (row) {
      // a row with our id: ours (won) or a concurrent same-id register (lost) — same content
      // means the same logical file; anything else keeps the old 409.
      if (
        row.userId !== userId ||
        row.checksumSha256 !== dto.checksumSha256 ||
        row.purpose !== purpose
      ) {
        throw new ConflictException('File id already exists');
      }
      return { file: FileRecordDto.from(row), created: true };
    }

    // lost on the (userId, checksum) partial unique — re-read the winner (scoped first to
    // preserve the assetId-aware lookup above; unscoped fallback for cross-asset matches)
    const winner =
      (await this.fileRepo.findOne({ where: naturalKey })) ??
      (await this.fileRepo.findOne({
        where: { userId, checksumSha256: dto.checksumSha256, purpose },
      }));
    if (!winner) throw new ServiceUnavailableException('File register conflict, please retry');
    return { file: FileRecordDto.from(winner), created: false };
  }

  // quota inputs: original-purpose bytes under originals/ only — thumbnails share the purpose
  // but live under derivatives/thumbnails/ (system output, not the user's uploads)
  private async sumOriginalBytes(userId: string): Promise<number> {
    const { used } = (await this.fileRepo
      .createQueryBuilder('f')
      .select('COALESCE(SUM(f.sizeBytes), 0)', 'used')
      .where('f.userId = :userId', { userId })
      .andWhere('f.purpose = :purpose', { purpose: 'original' })
      .andWhere('f."storageKey" LIKE :originals', { originals: 'originals/%' })
      .getRawOne<{ used: string }>()) ?? { used: '0' };
    return Number(used);
  }

  // shared by legacy upload and upload-session complete: sniff, checksum, dedup fast path,
  // quota, atomic save and the ON CONFLICT arbiter. The incoming temp file is unlinked
  // either way (finally below) — callers must treat `path` as consume-once.
  async persistOriginal(
    userId: string,
    file: OriginalFileInput,
  ): Promise<{ record: FileRecord; created: boolean }> {
    if (!file) {
      throw new BadRequestException(ingestErrorBody(400, 'No file provided', 'EMPTY_BODY'));
    }

    try {
      const mimeType = await sniffMime(file.path);
      if (!mimeType) throw new BadRequestException('Unsupported file type');

      const checksum = await this.computeChecksum(file.path);

      const existing = await this.fileRepo.findOne({
        where: { userId, checksumSha256: checksum, purpose: 'original' },
      });
      if (existing) return { record: existing, created: false };

      // ponytail: per-user quota (env/const, original-only SUM, AFTER the dedup fast-path above
      // so re-linking owned bytes costs nothing). Throwing before storage.save() leaves no orphan
      // bytes. TOCTOU: concurrent over-quota uploads can both pass the SUM (same race class as
      // the P1-5 dedup arbiter) — accepted for personal hosting; upgrade to a locked
      // SELECT ... FOR UPDATE on a per-user counter only with abuse evidence.
      const quota = loadEnv().STORAGE_QUOTA_BYTES;
      if (quota !== undefined) {
        const used = await this.sumOriginalBytes(userId);
        if (used + file.size > quota) {
          throw new PayloadTooLargeException(
            ingestErrorBody(413, 'Storage quota exceeded', 'QUOTA_EXCEEDED'),
          );
        }
      }

      const ext = extname(file.originalname).slice(1) || 'bin';
      const fileId = randomUUID();
      const storageKey = this.storage.buildKey('original', userId, fileId, ext);

      try {
        await this.storage.save(storageKey, file.path);
      } catch (err) {
        this.logger.error(`[UserFilesService] local storage save failed: ${String(err)}`);
        throw new BadRequestException('Failed to upload file to storage');
      }

      // P1-5: concurrent uploads of identical bytes both pass the fast path above, so the
      // insert is the arbiter — ON CONFLICT DO NOTHING + select-by-id below tells us whether
      // this upload won (repo.upsert() can't target the partial unique index, so orIgnore).
      try {
        await this.fileRepo
          .createQueryBuilder()
          .insert()
          .values({
            id: fileId,
            userId,
            storageKey,
            originalName: file.originalname,
            mimeType,
            sizeBytes: file.size,
            checksumSha256: checksum,
            purpose: 'original',
            assetId: null,
          })
          .orIgnore()
          .execute();
      } catch (err) {
        this.logger.error(
          `[UserFilesService] DB save failed, cleaning up file object: ${String(err)}`,
        );
        try {
          await this.storage.delete(storageKey);
        } catch (cleanupErr) {
          this.logger.error(`[UserFilesService] file cleanup failed: ${String(cleanupErr)}`);
        }
        throw err;
      }

      const mine = await this.fileRepo.findOne({ where: { id: fileId } });
      if (mine) return { record: mine, created: true };

      // lost the race: drop the orphaned bytes and return the winner
      try {
        await this.storage.delete(storageKey);
      } catch (cleanupErr) {
        this.logger.error(`[UserFilesService] loser file cleanup failed: ${String(cleanupErr)}`);
      }
      const winner = await this.fileRepo.findOne({
        where: { userId, checksumSha256: checksum, purpose: 'original' },
      });
      if (!winner) throw new ServiceUnavailableException('Upload conflict, please retry');
      return { record: winner, created: false };
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  private async computeChecksum(path: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  }

  private async getRecord(fileId: string): Promise<FileRecord> {
    // malformed ids must read as missing — the uuid cast below would 500 them instead
    if (!isUUID(fileId)) throw new NotFoundException('File not found');
    const record = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!record) throw new NotFoundException('File not found');
    return record;
  }

  private async getOwnedRecord(userId: string, fileId: string): Promise<FileRecord> {
    const record = await this.getRecord(fileId);
    if (record.userId !== userId) throw new NotFoundException('File not found');
    return record;
  }

  async getOne(userId: string, fileId: string) {
    return FileRecordDto.from(await this.getOwnedRecord(userId, fileId));
  }

  async existsMany(
    userId: string,
    items: { checksumSha256: string }[],
  ): Promise<FileExistsCheckHit[]> {
    // C6: batched to 2 queries (was N+1 sequential, up to 200 round trips) — same map shape.
    const unique = [...new Set(items.map((item) => item.checksumSha256))];
    if (unique.length === 0) return [];
    const files = await this.fileRepo.find({
      where: { userId, checksumSha256: In(unique), purpose: 'original' },
    });
    const byChecksum = new Map(files.map((f) => [f.checksumSha256, f]));
    const fileIds = files.map((f) => f.id);
    const assets =
      fileIds.length > 0
        ? await this.assetRepo.find({ where: { fileId: In(fileIds), userId } })
        : [];
    const assetByFileId = new Map(assets.map((a) => [a.fileId, a]));
    const hits = new Map<string, FileExistsCheckHit>();
    for (const checksum of unique) {
      const record = byChecksum.get(checksum);
      if (!record) {
        hits.set(checksum, { checksumSha256: checksum, exists: false });
        continue;
      }
      const asset = assetByFileId.get(record.id);
      hits.set(checksum, {
        checksumSha256: checksum,
        exists: true,
        existingFileId: record.id,
        ...(asset ? { existingAssetId: asset.id } : {}),
      });
    }
    return items.map((item) => hits.get(item.checksumSha256)!);
  }

  // usedBytes is the same original-only SUM the upload guard compares against;
  // limit/remaining go null when the quota env is unset (unlimited).
  // remaining is clamped at 0: it answers "how many more bytes may I upload", not debt.
  async storageQuota(userId: string): Promise<StorageQuotaResponse> {
    const usedBytes = await this.sumOriginalBytes(userId);
    const limitBytes = loadEnv().STORAGE_QUOTA_BYTES ?? null;
    if (limitBytes === null) return { usedBytes, limitBytes: null, remainingBytes: null };
    return { usedBytes, limitBytes, remainingBytes: Math.max(0, limitBytes - usedBytes) };
  }

  async serve(userId: string, fileId: string): Promise<{ path: string; record: FileRecord }> {
    const record = await this.getOwnedRecord(userId, fileId);
    return { path: this.storage.pathFor(record.storageKey), record };
  }
}
