import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, MoreThan, Repository } from 'typeorm'
import { readFile } from 'fs/promises'
import sharp from 'sharp'
import { Face } from '../database/entities'
import { Person } from '../database/entities'
import { Asset } from '../database/entities'
import { FileRecord } from '../database/entities'
import { findOwnedOr404 } from '../common/asset-ownership'
import { LocalStorageService } from '@photox/shared-config'
import { FaceResponseDto } from './dto/face.dto'
import { refreshPersonFaceCount } from './face-count'
import type { DetectedFaceInput, FaceDetectorKind } from '@photox/shared-types'

const DEFAULT_SIZE = 240
const MAX_SIZE = 600

@Injectable()
export class FacesService {
  constructor(
    @InjectRepository(Face)
    private readonly repo: Repository<Face>,
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly dataSource: DataSource,
    private readonly storage: LocalStorageService,
  ) {}

  async registerFaces(
    assetId: string,
    userId: string,
    faces: DetectedFaceInput[],
    detector: FaceDetectorKind | null = null,
  ): Promise<{ count: number }> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset')
    const entities = faces.map((f) => {
      const face = new Face()
      face.assetId = assetId
      face.userId = userId
      face.box = f.box
      face.confidence = f.confidence
      face.embedding = f.embedding
      face.detector = detector
      return face
    })
    await this.repo.save(entities)
    return { count: entities.length }
  }

  // ponytail: transactional companion to registerFaces — worker re-embed does DELETE then POST,
  // so a retry never duplicates stale rows
  async deleteForAsset(userId: string, assetId: string): Promise<{ deleted: number }> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset')
    return this.dataSource.transaction(async (em) => {
      const existing = await em.find(Face, { where: { assetId, userId } })
      if (existing.length === 0) return { deleted: 0 }

      const deletedIds = new Set(existing.map((f) => f.id))
      const personIds = [
        ...new Set(existing.map((f) => f.personId).filter((p): p is string => p !== null)),
      ]
      await em.delete(Face, { assetId, userId })

      for (const pid of personIds) {
        const person = await em.findOne(Person, { where: { id: pid, userId } })
        if (person?.coverFaceId && deletedIds.has(person.coverFaceId)) {
          await em.update(Person, { id: pid, userId }, { coverFaceId: null })
        }
        await refreshPersonFaceCount(em.getRepository(Face), em.getRepository(Person), pid, userId)
      }
      return { deleted: existing.length }
    })
  }

  async getForAsset(userId: string, assetId: string): Promise<FaceResponseDto[]> {
    await findOwnedOr404(this.assetRepo, assetId, userId, 'Asset')
    const faces = await this.repo.find({ where: { assetId } })
    return faces.map((f) => ({
      id: f.id,
      assetId: f.assetId,
      box: f.box,
      confidence: f.confidence,
      personId: f.personId ?? null,
    }))
  }

  async listForUser(userId: string, includeEmbeddings: boolean, excludeTrashed = false) {
    const faces = await this.repo.find({ where: { userId } })
    const trashedAssetIds = excludeTrashed
      ? new Set(
          (await this.assetRepo.find({ where: { userId, isTrashed: true }, select: ['id'] })).map(
            (a) => a.id,
          ),
        )
      : null
    return faces
      .filter((f) => !trashedAssetIds?.has(f.assetId))
      .map((f) => ({
        id: f.id,
        assetId: f.assetId,
        box: f.box,
        confidence: f.confidence,
        personId: f.personId ?? null,
        ...(includeEmbeddings ? { embedding: f.embedding } : {}),
      }))
  }

  // ponytail: keyset page over (userId, id ASC); trashed filtered in memory like listForUser —
  // pages can run short when trashed rows dominate; join-filter if that ever matters.
  async listForUserPaginated(
    userId: string,
    opts: {
      limit?: number
      cursor?: string
      includeEmbeddings?: boolean
      excludeTrashed?: boolean
    },
  ) {
    const limit = opts.limit ?? 500
    const faces = await this.repo.find({
      where: { userId, ...(opts.cursor ? { id: MoreThan(opts.cursor) } : {}) },
      order: { id: 'ASC' },
      take: limit,
    })
    const trashedAssetIds = opts.excludeTrashed
      ? new Set(
          (await this.assetRepo.find({ where: { userId, isTrashed: true }, select: ['id'] })).map(
            (a) => a.id,
          ),
        )
      : null
    const items = faces
      .filter((f) => !trashedAssetIds?.has(f.assetId))
      .map((f) => ({
        id: f.id,
        assetId: f.assetId,
        box: f.box,
        confidence: f.confidence,
        personId: f.personId ?? null,
        ...(opts.includeEmbeddings ? { embedding: f.embedding } : {}),
      }))
    return { items, nextCursor: faces.length < limit ? null : (faces.at(-1)?.id ?? null) }
  }

  async assignPerson(userId: string, faceId: string, personId: string | null): Promise<void> {
    const face = await findOwnedOr404(this.repo, faceId, userId, 'Face')
    if (personId) {
      await findOwnedOr404(this.personRepo, personId, userId, 'Person')
    }
    const oldPersonId = face.personId
    face.personId = personId
    await this.repo.save(face)
    // ponytail: keep Person.faceCount in sync after assign/unassign (cluster job + manual edits both route here)
    if (oldPersonId) await refreshPersonFaceCount(this.repo, this.personRepo, oldPersonId, userId)
    if (personId) await refreshPersonFaceCount(this.repo, this.personRepo, personId, userId)
  }

  // ponytail: synchronous crop on demand. Caching the resulting jpeg (e.g. via a `face_thumbs` table or local disk) is the upgrade path when traffic warrants.
  async getThumb(faceId: string, userId: string, size: number): Promise<Buffer> {
    const target = Math.max(
      32,
      Math.min(MAX_SIZE, Math.floor(Number.isFinite(size) ? size : DEFAULT_SIZE)),
    )
    const face = await findOwnedOr404(this.repo, faceId, userId, 'Face')
    const asset = await findOwnedOr404(this.assetRepo, face.assetId, userId, 'Asset')
    const record = await findOwnedOr404(this.fileRepo, asset.fileId, userId, 'File')
    const buf = await readFile(this.storage.pathFor(record.storageKey))

    const meta = await sharp(buf).metadata()
    const imgW = meta.width ?? 0
    const imgH = meta.height ?? 0
    if (!imgW || !imgH) throw new NotFoundException('Source image unreadable')

    const pad = 0.35
    const left = Math.max(0, Math.floor(face.box.x - face.box.w * pad))
    const top = Math.max(0, Math.floor(face.box.y - face.box.h * pad))
    const width = Math.min(imgW - left, Math.ceil(face.box.w * (1 + pad * 2)))
    const height = Math.min(imgH - top, Math.ceil(face.box.h * (1 + pad * 2)))
    if (width <= 0 || height <= 0) throw new NotFoundException('Face box out of bounds')

    return sharp(buf)
      .extract({ left, top, width, height })
      .resize({ width: target, height: target, fit: 'cover' })
      .jpeg({ quality: 82 })
      .toBuffer()
  }
}
