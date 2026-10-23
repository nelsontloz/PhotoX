import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository, type FindOptionsRelations } from 'typeorm'
import * as crypto from 'crypto'
import { Share } from './entities/share.entity'
import { isPostgresUniqueViolation } from '../assets/assets.service'
import { Asset } from '../database/entities'
import { FileRecord } from '../database/entities'
import { Album } from '../albums/entities/album.entity'
import { AlbumAsset } from '../albums/entities/album-asset.entity'
import { findOwnedOr404 } from '../common/asset-ownership'
import { CreateShareDto } from './dto/create-share.dto'
import type {
  AlbumShareDto,
  AssetShareDto,
  PublicAlbumAssetsResponse,
  PublicShareAsset,
  PublicShareInfo,
  PublicShareResponse,
  ShareDto,
  ShareListItem,
  ShareListResponse,
} from '@photox/shared-types'

// ponytail: hardcoded 30d share lifetime — per-share expiresIn on the create DTO if owners need control
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000

type ShareTarget =
  | { kind: 'asset'; assetId: string; albumId: null }
  | { kind: 'album'; assetId: null; albumId: string }

@Injectable()
export class SharesService {
  constructor(
    @InjectRepository(Share)
    private readonly shareRepo: Repository<Share>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(Album)
    private readonly albumRepo: Repository<Album>,
    @InjectRepository(AlbumAsset)
    private readonly albumAssetRepo: Repository<AlbumAsset>,
  ) {}

  /** sha256 of a presented capability for lookups — writes store hashes, see create(). */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
  }

  /**
   * Token resolution across the hash migration: new rows store sha256 (match first), legacy
   * rows store plaintext (raw fallback). Presenting T matches only rows storing T or sha256(T)
   * — no escalation beyond the pre-hash contract — and misses stay uniform-404 downstream.
   */
  private async findShareByToken(
    token: string,
    relations?: FindOptionsRelations<Share>,
  ): Promise<Share | null> {
    const hashed = await this.shareRepo.findOne({
      where: { token: this.hashToken(token) },
      relations,
    })
    if (hashed) return hashed
    return this.shareRepo.findOne({ where: { token }, relations })
  }

  private expiresAt(): Date {
    return new Date(Date.now() + SHARE_TTL_MS)
  }

  async create(userId: string, dto: CreateShareDto): Promise<ShareDto> {
    const { assetId, albumId } = dto
    if ((assetId === undefined) === (albumId === undefined)) {
      throw new BadRequestException('Provide exactly one of assetId or albumId')
    }

    const target: ShareTarget =
      assetId !== undefined
        ? { kind: 'asset', assetId, albumId: null }
        : { kind: 'album', assetId: null, albumId: albumId! }

    let album: Album | null = null
    if (target.kind === 'asset') {
      const asset = await this.assetRepo.findOne({
        where: { id: target.assetId, userId, isTrashed: false },
      })
      if (!asset) throw new NotFoundException('Asset not found')
    } else {
      album = await findOwnedOr404(this.albumRepo, target.albumId, userId, 'Album')
    }

    const ownerFilter =
      target.kind === 'asset'
        ? { assetId: target.assetId, userId }
        : { albumId: target.albumId, userId }
    const existing = await this.shareRepo.findOne({ where: ownerFilter })
    // rotation: re-sharing mints a new token and kills the old URL (compat break by design)
    if (existing) await this.shareRepo.delete(existing.id)

    const raw = crypto.randomBytes(16).toString('base64url')
    const build = () =>
      this.shareRepo.create({
        userId,
        ...target,
        token: this.hashToken(raw),
        expiresAt: this.expiresAt(),
      })
    const toDto = async (saved: Share): Promise<ShareDto> =>
      target.kind === 'asset'
        ? { ...this.toAssetDto(saved), token: raw }
        : { ...(await this.toAlbumDto(saved, album)), token: raw }

    try {
      return await toDto(await this.shareRepo.save(build()))
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) throw err
      // C10: concurrent rotation raced past the find-existing/delete above — inline retry
      // (last-writer-wins) so double-submit returns a working capability instead of a 500.
      // The winner's raw is unrecoverable (only its hash is stored), so returning the
      // winner row would hand back a hash, not a working token.
      await this.shareRepo.delete(ownerFilter)
      return await toDto(await this.shareRepo.save(build()))
    }
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
    const items: ShareListItem[] = []
    for (const row of rows) {
      items.push(
        row.kind === 'album' ? await this.toAlbumDto(row, row.album) : this.toAssetDto(row),
      )
    }
    return { items }
  }

  async revoke(userId: string, shareId: string): Promise<void> {
    await findOwnedOr404(this.shareRepo, shareId, userId, 'Share')
    await this.shareRepo.delete(shareId)
  }

  async getByToken(token: string): Promise<PublicShareResponse> {
    const share = await this.findShareByToken(token, { asset: { thumbnails: true }, album: true })
    // expired and unknown share identically: never distinguish the two
    if (!share || (share.expiresAt && new Date() > share.expiresAt))
      throw new NotFoundException('Share not found')

    if (share.kind === 'album') {
      if (!share.album) throw new NotFoundException('Share not found')
      const shareDto = await this.toAlbumDto(share, share.album)
      return {
        kind: 'album',
        share: this.toPublicShare(share),
        album: {
          id: share.album.id,
          name: share.album.name,
          description: share.album.description,
          assetCount: shareDto.albumAssetCount,
        },
      }
    }

    if (!share.asset || share.asset.isTrashed) throw new NotFoundException('Share not found')
    return {
      kind: 'asset',
      share: this.toPublicShare(share),
      asset: this.toPublicAsset(share.asset),
    }
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

  async getAlbumAssetFileId(
    token: string,
    assetId: string,
    size?: string,
  ): Promise<{ fileId: string; userId: string }> {
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
      relations: { thumbnails: true },
    })
    if (!asset) throw new NotFoundException('Asset not found')

    if (size === 'sm') {
      // sm-only: a missing sm thumbnail 404s — never fall back to the (possibly huge) original
      const thumbFileId = asset.thumbnails?.find((thumb) => thumb.size === 'sm')?.fileId
      if (!thumbFileId) throw new NotFoundException('Asset not found')
      return { fileId: thumbFileId, userId: share.userId }
    }
    if (size !== undefined) throw new BadRequestException(`Unsupported size '${size}'`)
    // Same pick as the in-app viewer: when the worker transcoded the video (non-h264 original),
    // browsers cannot decode the original — serve the AV1/webm derivative.
    const fileId = await this.playableFileId(share.userId, asset.transcodeFileId, asset.fileId)
    return { fileId, userId: share.userId }
  }

  /**
   * Serve the transcode derivative only when its file row still belongs to the share owner;
   * otherwise fall back to the original. A poisoned transcodeFileId pointer must never pull
   * another user's bytes into a public capability URL.
   */
  async playableFileId(
    userId: string,
    transcodeFileId: string | null,
    fallbackFileId: string,
  ): Promise<string> {
    if (!transcodeFileId) return fallbackFileId
    const file = await this.fileRepo.findOne({ where: { id: transcodeFileId } })
    return file?.userId === userId ? transcodeFileId : fallbackFileId
  }

  private async getAlbumShare(token: string): Promise<Share> {
    const share = await this.findShareByToken(token)
    if (share?.kind !== 'album' || !share.albumId) {
      throw new NotFoundException('Share not found')
    }
    if (share.expiresAt && new Date() > share.expiresAt) {
      throw new NotFoundException('Share not found')
    }
    return share
  }

  /**
   * Stream target for a single-asset share: resolved server-side from the token so the public
   * projection never has to expose file ids. Transcode-guarded playable logic unchanged.
   */
  async getAssetStreamTarget(token: string): Promise<{ fileId: string; userId: string }> {
    const share = await this.findShareByToken(token, { asset: { thumbnails: true } })
    // optional chains: a missing share must read the same as a wrong-kind/expired one
    const expiresAt = share?.expiresAt ?? null
    if (share?.kind !== 'asset' || (expiresAt && new Date() > expiresAt))
      throw new NotFoundException('Share not found')
    if (!share?.asset || share.asset.isTrashed) throw new NotFoundException('Share not found')
    const fileId = await this.playableFileId(
      share.userId,
      share.asset.transcodeFileId,
      share.asset.fileId,
    )
    return { fileId, userId: share.userId }
  }

  private toPublicAsset(asset: Asset): PublicShareAsset {
    return {
      id: asset.id,
      kind: asset.kind,
      hasTranscode: asset.transcodeFileId !== null,
      title: asset.title,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      takenAt: asset.takenAt instanceof Date ? asset.takenAt.toISOString() : asset.takenAt,
    }
  }

  private toAssetDto(share: Share): Omit<AssetShareDto, 'token'> {
    return {
      id: share.id,
      kind: 'asset',
      userId: share.userId,
      assetId: share.assetId!,
      assetFileId: share.asset?.fileId ?? null,
      assetThumbFileId: share.asset?.thumbnails?.find((t) => t.size === 'sm')?.fileId ?? null,
      assetKind: share.asset?.kind ?? null,
      createdAt: share.createdAt instanceof Date ? share.createdAt.toISOString() : share.createdAt,
    }
  }

  private toPublicShare(share: Share): PublicShareInfo {
    return {
      kind: share.kind,
      createdAt: share.createdAt instanceof Date ? share.createdAt.toISOString() : share.createdAt,
      expiresAt: share.expiresAt instanceof Date ? share.expiresAt.toISOString() : share.expiresAt,
    }
  }

  private async toAlbumDto(
    share: Share,
    album?: Album | null,
  ): Promise<Omit<AlbumShareDto, 'token'>> {
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
