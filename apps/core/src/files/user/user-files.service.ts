import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository, FindOptionsWhere } from 'typeorm'
import { randomUUID, createHash } from 'crypto'
import { createReadStream } from 'fs'
import { open, unlink } from 'fs/promises'
import { extname } from 'path'
import { pipeline } from 'stream/promises'
import { Asset, FileRecord } from '../../database/entities'
import { loadEnv, LocalStorageService } from '@photox/shared-config'
import { findOwnedOr404 } from '../../common/asset-ownership'
import { RegisterFileBodyDto } from './dto/register-file.body.dto'
import type { UploadFileBodyDto } from './dto/upload-file.body.dto'
import { FileRecordDto } from '../file-record.dto'
import { AssetsService } from '../../assets/assets.service'
import { BullMqService } from '../../queue/bullmq.service'
import type {
  Asset as AssetResponse,
  FileExistsCheckHit,
  StorageQuotaResponse,
} from '@photox/shared-types'

export interface UploadedDiskFile {
  path: string
  originalname: string
  mimetype: string
  size: number
}

// ponytail: header sniff only (no full decode) — enough to keep svg/html and unknown bytes out of
// storage while allowing the image/video whitelist; upgrade to a real decode scan (sharp/ffprobe)
// if uploads ever become publicly reachable
const MIME_SNIFFERS: { mime: string; match: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    match: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: 'image/gif', match: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    mime: 'image/webp',
    match: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    mime: 'video/x-msvideo',
    match: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'AVI ',
  },
  {
    mime: 'video/webm',
    match: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  },
]

// ISO-BMFF: `ftyp` box at offset 4, major brand at offset 8 decides the canonical type —
// heic family (iPhone photos), heif, avif, quicktime (iPhone .mov) and mp4 fall back
function isoBmffMime(b: Buffer): string | null {
  if (b.subarray(4, 8).toString('latin1') !== 'ftyp') return null
  const brand = b.subarray(8, 12).toString('latin1')
  if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') {
    return 'image/heic'
  }
  if (brand === 'mif1' || brand === 'msf1') return 'image/heif'
  if (brand === 'avif' || brand === 'avis') return 'image/avif'
  if (brand === 'qt  ') return 'video/quicktime'
  return 'video/mp4'
}

async function sniffMime(path: string): Promise<string | null> {
  const buf = Buffer.alloc(12)
  const handle = await open(path, 'r')
  try {
    if ((await handle.read(buf, 0, buf.length, 0)).bytesRead < buf.length) return null
  } finally {
    await handle.close()
  }
  return isoBmffMime(buf) ?? MIME_SNIFFERS.find((s) => s.match(buf))?.mime ?? null
}

@Injectable()
export class UserFilesService {
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
    file: UploadedDiskFile,
    meta: UploadFileBodyDto = {},
  ): Promise<AssetResponse> {
    const { record, created } = await this.storeFile(userId, file)
    // C2-narrowed: client `kind` is accepted-but-ignored (see UploadFileBodyDto) — derive
    // solely from the sniffed mime so JPEG bytes + kind=video can't enter the video pipeline.
    const kind = this.kindFromMime(record.mimeType)
    if (!kind) {
      throw new BadRequestException('Unsupported file type')
    }
    if (!created) {
      const existing = await this.assetRepo.findOne({ where: { fileId: record.id, userId } })
      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          message: 'File already uploaded',
          existingAssetId: existing.id,
          existingFileId: record.id,
        })
      }
    }
    const asset = await this.assets.create(userId, {
      fileId: record.id,
      kind,
      title: meta.title,
      description: meta.description,
      takenAt: meta.takenAt,
      mimeType: record.mimeType,
      sizeBytes: file.size,
      originalName: file.originalname,
    })
    // P0-3: every enqueue is awaited and a single Redis loss fails the upload — the rows
    // already exist, but a silent 201 would orphan them with no job ever coming
    const enqueues: Promise<boolean>[] = [
      this.bullMq.enqueueThumbnails(asset.id, record.id, userId),
      this.bullMq.enqueue('process-metadata', 'process-metadata', {
        assetId: asset.id,
        fileId: record.id,
        userId,
        kind,
      }),
    ]
    if (kind === 'photo') {
      enqueues.push(
        this.bullMq.enqueue('process-faces', 'process-faces', {
          assetId: asset.id,
          fileId: record.id,
          userId,
        }),
        // videos out of scope for vision search — only photos get image embeddings
        this.bullMq.enqueueAssetJob('embed', asset.id, record.id, userId),
        this.bullMq.enqueueAssetJob('ocr', asset.id, record.id, userId),
        this.bullMq.enqueueAssetJob('detect', asset.id, record.id, userId),
      )
    } else {
      enqueues.push(this.bullMq.enqueueVideo(asset.id, record.id, userId))
    }
    if ((await Promise.all(enqueues)).includes(false)) {
      throw new ServiceUnavailableException('Failed to enqueue background processing jobs')
    }
    return asset
  }

  // ponytail: workers write bytes first, then register the row; core recomputes the
  // storageKey from (kind, user, id, ext) so a client can never point at another user's bytes
  async register(
    userId: string,
    dto: RegisterFileBodyDto,
  ): Promise<{ file: FileRecordDto; created: boolean }> {
    const purpose = dto.kind === 'transcode' ? 'transcode' : 'original'
    const naturalKey: FindOptionsWhere<FileRecord> = {
      userId,
      checksumSha256: dto.checksumSha256,
      purpose,
      ...(dto.assetId ? { assetId: dto.assetId } : {}),
    }
    const existing = await this.fileRepo.findOne({ where: naturalKey })
    if (existing) return { file: FileRecordDto.from(existing), created: false }

    if (await this.fileRepo.exists({ where: { id: dto.id } })) {
      throw new ConflictException('File id already exists')
    }

    if (dto.assetId) {
      await findOwnedOr404(this.assetRepo, dto.assetId, userId, 'Asset')
    }

    const storageKey = this.storage.buildKey(dto.kind, userId, dto.id, dto.ext)
    if (!(await this.storage.exists(storageKey))) {
      throw new UnprocessableEntityException('File bytes not found in storage')
    }

    // P1-5: same ON CONFLICT DO NOTHING arbiter as storeFile — concurrent registers of
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
      .execute()

    const row = await this.fileRepo.findOne({ where: { id: dto.id } })
    if (row) {
      // a row with our id: ours (won) or a concurrent same-id register (lost) — same content
      // means the same logical file; anything else keeps the old 409.
      if (
        row.userId !== userId ||
        row.checksumSha256 !== dto.checksumSha256 ||
        row.purpose !== purpose
      ) {
        throw new ConflictException('File id already exists')
      }
      return { file: FileRecordDto.from(row), created: true }
    }

    // lost on the (userId, checksum) partial unique — re-read the winner (scoped first to
    // preserve the assetId-aware lookup above; unscoped fallback for cross-asset matches)
    const winner =
      (await this.fileRepo.findOne({ where: naturalKey })) ??
      (await this.fileRepo.findOne({
        where: { userId, checksumSha256: dto.checksumSha256, purpose },
      }))
    if (!winner) throw new ServiceUnavailableException('File register conflict, please retry')
    return { file: FileRecordDto.from(winner), created: false }
  }

  private kindFromMime(mimetype: string): 'photo' | 'video' | null {
    if (mimetype.startsWith('image/')) return 'photo'
    if (mimetype.startsWith('video/')) return 'video'
    return null
  }

  // quota inputs: original-purpose bytes only (thumbnails/transcodes are system output);
  // one raw SUM row, shared by the upload guard and GET /files/quota
  private async sumOriginalBytes(userId: string): Promise<number> {
    const { used } = (await this.fileRepo
      .createQueryBuilder('f')
      .select('COALESCE(SUM(f.sizeBytes), 0)', 'used')
      .where('f.userId = :userId', { userId })
      .andWhere('f.purpose = :purpose', { purpose: 'original' })
      .getRawOne<{ used: string }>()) ?? { used: '0' }
    return Number(used)
  }

  private async storeFile(
    userId: string,
    file: UploadedDiskFile,
  ): Promise<{ record: FileRecord; created: boolean }> {
    if (!file) {
      throw new BadRequestException('No file provided')
    }

    try {
      const mimeType = await sniffMime(file.path)
      if (!mimeType) throw new BadRequestException('Unsupported file type')

      const checksum = await this.computeChecksum(file.path)

      const existing = await this.fileRepo.findOne({
        where: { userId, checksumSha256: checksum, purpose: 'original' },
      })
      if (existing) return { record: existing, created: false }

      // ponytail: per-user quota (env/const, original-only SUM, AFTER the dedup fast-path above
      // so re-linking owned bytes costs nothing). Throwing before storage.save() leaves no orphan
      // bytes. TOCTOU: concurrent over-quota uploads can both pass the SUM (same race class as
      // the P1-5 dedup arbiter) — accepted for personal hosting; upgrade to a locked
      // SELECT ... FOR UPDATE on a per-user counter only with abuse evidence.
      const quota = loadEnv().STORAGE_QUOTA_BYTES
      if (quota !== undefined) {
        const used = await this.sumOriginalBytes(userId)
        if (used + file.size > quota) {
          throw new PayloadTooLargeException('Storage quota exceeded')
        }
      }

      const ext = extname(file.originalname).slice(1) || 'bin'
      const fileId = randomUUID()
      const storageKey = this.storage.buildKey('original', userId, fileId, ext)

      try {
        await this.storage.save(storageKey, file.path)
      } catch (err) {
        console.error('[UserFilesService] Local storage file save failed', err)
        throw new BadRequestException('Failed to upload file to storage')
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
          .execute()
      } catch (err) {
        console.error('[UserFilesService] DB save failed, cleaning up file object', err)
        try {
          await this.storage.delete(storageKey)
        } catch (cleanupErr) {
          console.error('[UserFilesService] File cleanup failed', cleanupErr)
        }
        throw err
      }

      const mine = await this.fileRepo.findOne({ where: { id: fileId } })
      if (mine) return { record: mine, created: true }

      // lost the race: drop the orphaned bytes and return the winner
      try {
        await this.storage.delete(storageKey)
      } catch (cleanupErr) {
        console.error('[UserFilesService] Loser file cleanup failed', cleanupErr)
      }
      const winner = await this.fileRepo.findOne({
        where: { userId, checksumSha256: checksum, purpose: 'original' },
      })
      if (!winner) throw new ServiceUnavailableException('Upload conflict, please retry')
      return { record: winner, created: false }
    } finally {
      await unlink(file.path).catch(() => undefined)
    }
  }

  private async computeChecksum(path: string): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    return hash.digest('hex')
  }

  private async getRecord(fileId: string): Promise<FileRecord> {
    // malformed ids must read as missing — the uuid cast below would 500 them instead
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId))
      throw new NotFoundException('File not found')
    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    if (!record) throw new NotFoundException('File not found')
    return record
  }

  private async getOwnedRecord(userId: string, fileId: string): Promise<FileRecord> {
    const record = await this.getRecord(fileId)
    if (record.userId !== userId) throw new NotFoundException('File not found')
    return record
  }

  async getOne(userId: string, fileId: string) {
    return FileRecordDto.from(await this.getOwnedRecord(userId, fileId))
  }

  async existsMany(
    userId: string,
    items: { checksumSha256: string; sizeBytes?: number }[],
  ): Promise<FileExistsCheckHit[]> {
    // C6: batched to 2 queries (was N+1 sequential, up to 200 round trips) — same map shape.
    const unique = [...new Set(items.map((item) => item.checksumSha256))]
    if (unique.length === 0) return []
    const files = await this.fileRepo.find({
      where: { userId, checksumSha256: In(unique), purpose: 'original' },
    })
    const byChecksum = new Map(files.map((f) => [f.checksumSha256, f]))
    const fileIds = files.map((f) => f.id)
    const assets =
      fileIds.length > 0
        ? await this.assetRepo.find({ where: { fileId: In(fileIds), userId } })
        : []
    const assetByFileId = new Map(assets.map((a) => [a.fileId, a]))
    const hits = new Map<string, FileExistsCheckHit>()
    for (const checksum of unique) {
      const record = byChecksum.get(checksum)
      if (!record) {
        hits.set(checksum, { checksumSha256: checksum, exists: false })
        continue
      }
      const asset = assetByFileId.get(record.id)
      hits.set(checksum, {
        checksumSha256: checksum,
        exists: true,
        existingFileId: record.id,
        ...(asset ? { existingAssetId: asset.id } : {}),
      })
    }
    return items.map((item) => hits.get(item.checksumSha256)!)
  }

  // GET /api/v1/files/quota — usedBytes is the same original-only SUM the upload guard
  // compares against; limit/remaining go null when the quota env is unset (unlimited).
  // remaining is clamped at 0: it answers "how many more bytes may I upload", not debt.
  async storageQuota(userId: string): Promise<StorageQuotaResponse> {
    const usedBytes = await this.sumOriginalBytes(userId)
    const limitBytes = loadEnv().STORAGE_QUOTA_BYTES ?? null
    if (limitBytes === null) return { usedBytes, limitBytes: null, remainingBytes: null }
    return { usedBytes, limitBytes, remainingBytes: Math.max(0, limitBytes - usedBytes) }
  }

  async serve(userId: string, fileId: string): Promise<{ path: string; record: FileRecord }> {
    const record = await this.getOwnedRecord(userId, fileId)
    return { path: this.storage.pathFor(record.storageKey), record }
  }
}
