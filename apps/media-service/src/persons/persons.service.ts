import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Person } from './entities/person.entity'
import { Face } from '../faces/entities/face.entity'
import { Asset } from '../entities/asset.entity'
import type {
  PersonDto,
  PersonListResponse,
  PersonAssetsResponse,
  ReassignFacesResponse,
} from '@photox/shared-types'

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    @InjectRepository(Face)
    private readonly faceRepo: Repository<Face>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  async list(userId: string, limit = 20, offset = 0): Promise<PersonListResponse> {
    const qb = this.personRepo.createQueryBuilder('p').where('p.userId = :userId', { userId })

    const total = await qb.getCount()

    const persons = await qb
      .orderBy('p.faceCount', 'DESC')
      .addOrderBy('p.updatedAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany()

    return {
      items: persons.map((p) => this.toListItem(p)),
      total,
      limit,
      offset,
    }
  }

  async getOne(userId: string, id: string): Promise<PersonDto> {
    const person = await this.personRepo.findOne({ where: { id, userId } })
    if (!person) throw new NotFoundException('Person not found')
    return this.toListItem(person)
  }

  async create(userId: string, clusterLabel: string): Promise<{ id: string }> {
    const person = new Person()
    person.userId = userId
    person.name = null
    person.clusterLabel = clusterLabel
    person.faceCount = 0
    const saved = await this.personRepo.save(person)
    return { id: saved.id }
  }

  async update(userId: string, id: string, name: string | null): Promise<PersonDto> {
    const person = await this.personRepo.findOne({ where: { id, userId } })
    if (!person) throw new NotFoundException('Person not found')
    await this.personRepo.update(id, { name })
    const updated = await this.personRepo.findOne({ where: { id } })
    return this.toListItem(updated!)
  }

  async setCover(userId: string, id: string, faceId: string): Promise<{ ok: true }> {
    const person = await this.personRepo.findOne({ where: { id, userId } })
    if (!person) throw new NotFoundException('Person not found')

    const face = await this.faceRepo.findOne({ where: { id: faceId, userId } })
    if (!face) throw new NotFoundException('Face not found')

    if (face.personId !== id) {
      throw new ForbiddenException('Face does not belong to this person')
    }

    await this.personRepo.update(id, { coverFaceId: faceId })
    return { ok: true }
  }

  async getAssetsForPerson(
    userId: string,
    id: string,
    limit = 20,
    offset = 0,
  ): Promise<PersonAssetsResponse> {
    const person = await this.personRepo.findOne({ where: { id, userId } })
    if (!person) throw new NotFoundException('Person not found')

    // ponytail: per-asset rollup — one row per asset containing this person; faceId is any of the person's faces in that asset (used to fetch the face box for overlay)
    const rows = await this.faceRepo
      .createQueryBuilder('f')
      .select('f."assetId"', 'assetId')
      .addSelect(`MIN(f.id::text)::uuid`, 'faceId')
      .addSelect('COUNT(*)', 'faceCount')
      .addSelect('MAX(f."createdAt")', 'lastSeen')
      .where('f."personId" = :personId', { personId: id })
      .andWhere('f."userId" = :userId', { userId })
      .groupBy('f."assetId"')
      .orderBy('"lastSeen"', 'DESC')
      .limit(limit)
      .offset(offset)
      .getRawMany<{ assetId: string; faceId: string; faceCount: string; lastSeen: Date }>()

    const total = await this.faceRepo
      .createQueryBuilder('f')
      .select('COUNT(DISTINCT f."assetId")')
      .where('f."personId" = :personId', { personId: id })
      .andWhere('f."userId" = :userId', { userId })
      .getRawOne<{ count: string }>()
      .then((r) => Number(r?.count ?? 0))

    if (rows.length === 0) {
      return { personId: id, items: [], total, limit, offset }
    }

    const assets = await this.assetRepo
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .addSelect('a."uploadedAt"', 'uploadedAt')
      .where('a.id IN (:...assetIds)', { assetIds: rows.map((r) => r.assetId) })
      .getRawMany<{ id: string; uploadedAt: Date }>()

    const uploadedById = new Map(
      assets.map((a) => [
        a.id,
        a.uploadedAt instanceof Date ? a.uploadedAt.toISOString() : String(a.uploadedAt),
      ]),
    )

    const items = rows.map((r) => ({
      assetId: r.assetId,
      faceId: r.faceId,
      uploadedAt: uploadedById.get(r.assetId) ?? '',
      faceCount: Number(r.faceCount),
    }))

    return { personId: id, items, total, limit, offset }
  }

  async reassignFaces(
    userId: string,
    body: { toPersonId: string | null; faceIds: string[] },
  ): Promise<ReassignFacesResponse> {
    const toUpdate = await this.faceRepo.find({
      where: body.faceIds.map((fid) => ({ id: fid, userId })),
    })

    if (toUpdate.length === 0) return { moved: 0 }

    const affectedPersonIds = new Set<string>()
    for (const face of toUpdate) {
      if (face.personId) affectedPersonIds.add(face.personId)
      face.personId = body.toPersonId
    }
    await this.faceRepo.save(toUpdate)

    if (body.toPersonId) affectedPersonIds.add(body.toPersonId)

    for (const pid of affectedPersonIds) {
      const count = await this.faceRepo.count({ where: { personId: pid, userId } })
      await this.personRepo.update(pid, { faceCount: count })
    }

    return { moved: toUpdate.length }
  }

  private toListItem(person: Person): PersonDto {
    return {
      id: person.id,
      userId: person.userId,
      name: person.name,
      coverFaceId: person.coverFaceId,
      coverFaceUrl: person.coverFaceId
        ? `/api/v1/faces/${person.coverFaceId}/thumb?userId=${person.userId}`
        : null,
      clusterLabel: person.clusterLabel,
      faceCount: person.faceCount,
      createdAt:
        person.createdAt instanceof Date
          ? person.createdAt.toISOString()
          : String(person.createdAt),
      updatedAt:
        person.updatedAt instanceof Date
          ? person.updatedAt.toISOString()
          : String(person.updatedAt),
    }
  }
}
