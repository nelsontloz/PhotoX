import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { Face } from '../database/entities'
import { Person } from '../database/entities'
import { Asset } from '../database/entities'
import { assertAssetOwned } from '../common/asset-ownership'
import { FaceResponseDto } from './dto/face.dto'
import { refreshPersonFaceCount } from './face-count'
import type { DetectedFaceInput, FaceDetectorKind } from '@photox/shared-types'

@Injectable()
export class FacesService {
  constructor(
    @InjectRepository(Face)
    private readonly repo: Repository<Face>,
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly dataSource: DataSource,
  ) {}

  async registerFaces(
    assetId: string,
    userId: string,
    faces: DetectedFaceInput[],
    detector: FaceDetectorKind | null = null,
  ): Promise<{ count: number }> {
    await assertAssetOwned(this.assetRepo, userId, assetId)
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
    await assertAssetOwned(this.assetRepo, userId, assetId)
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
    await assertAssetOwned(this.assetRepo, userId, assetId)
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

  async assignPerson(userId: string, faceId: string, personId: string | null): Promise<void> {
    const face = await this.repo.findOne({ where: { id: faceId, userId } })
    if (!face) throw new NotFoundException('Face not found')
    if (personId) {
      const person = await this.personRepo.findOne({ where: { id: personId, userId } })
      if (!person) throw new NotFoundException('Person not found')
    }
    const oldPersonId = face.personId
    face.personId = personId
    await this.repo.save(face)
    // ponytail: keep Person.faceCount in sync after assign/unassign (cluster job + manual edits both route here)
    if (oldPersonId) await refreshPersonFaceCount(this.repo, this.personRepo, oldPersonId, userId)
    if (personId) await refreshPersonFaceCount(this.repo, this.personRepo, personId, userId)
  }
}
