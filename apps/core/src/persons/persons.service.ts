import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import { Person } from '../database/entities'
import { Face } from '../database/entities'
import { Asset } from '../database/entities'
import { refreshPersonFaceCount, countLiveFaces } from '../faces/face-count'
import type { ApplyClustersDto } from './dto/apply-clusters.dto'
import type { PersonDto, PersonListResponse, PersonAssetsResponse } from '@photox/shared-types'

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    @InjectRepository(Face)
    private readonly faceRepo: Repository<Face>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly dataSource: DataSource,
  ) {}

  async list(userId: string, limit = 20, offset = 0): Promise<PersonListResponse> {
    const total = await this.personRepo
      .createQueryBuilder('p')
      .where('p.userId = :userId', { userId })
      .getCount()

    interface PersonRow {
      id: string
      userId: string
      name: string | null
      coverFaceId: string | null
      clusterLabel: string | null
      faceCount: number
      createdAt: Date
      updatedAt: Date
      liveFaceCount: string
    }

    const rows: PersonRow[] = await this.personRepo.query(
      `SELECT p.id, p."userId", p.name, p."coverFaceId", p."clusterLabel",
              p."faceCount", p."createdAt", p."updatedAt",
              COALESCE(fc.cnt, 0) AS "liveFaceCount"
       FROM persons p
       LEFT JOIN (
         SELECT f."personId" AS pid, COUNT(*)::int AS cnt
         FROM faces f
         INNER JOIN assets a ON a.id = f."assetId"
         WHERE f."userId" = $1 AND a."isTrashed" = false
         GROUP BY f."personId"
       ) fc ON fc.pid = p.id
       WHERE p."userId" = $1
       ORDER BY "liveFaceCount" DESC, p."updatedAt" DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    )

    const persons = rows.map((r) =>
      this.toListItem({
        id: r.id,
        userId: r.userId,
        name: r.name,
        coverFaceId: r.coverFaceId,
        clusterLabel: r.clusterLabel,
        faceCount: Number(r.liveFaceCount ?? 0),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }),
    )

    return {
      items: persons,
      total,
      limit,
      offset,
    }
  }

  async getOne(userId: string, id: string): Promise<PersonDto> {
    const person = await this.personRepo.findOne({ where: { id, userId } })
    if (!person) throw new NotFoundException('Person not found')
    person.faceCount = await countLiveFaces(this.faceRepo, id, userId)
    return this.toListItem(person)
  }

  async update(userId: string, id: string, name: string | null): Promise<PersonDto> {
    const person = await this.personRepo.findOne({ where: { id, userId } })
    if (!person) throw new NotFoundException('Person not found')
    await this.personRepo.update(id, { name })
    const updated = await this.personRepo.findOne({ where: { id } })
    return this.toListItem(updated!)
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
      .innerJoin('assets', 'a', 'a.id = f."assetId"')
      .select('f."assetId"', 'assetId')
      .addSelect(`MIN(f.id::text)::uuid`, 'faceId')
      .addSelect('COUNT(*)', 'faceCount')
      .addSelect('MAX(f."createdAt")', 'lastSeen')
      .where('f."personId" = :personId', { personId: id })
      .andWhere('f."userId" = :userId', { userId })
      .andWhere('a."isTrashed" = :isTrashed', { isTrashed: false })
      .groupBy('f."assetId"')
      .orderBy('"lastSeen"', 'DESC')
      .limit(limit)
      .offset(offset)
      .getRawMany<{ assetId: string; faceId: string; faceCount: string; lastSeen: Date }>()

    const total = await this.faceRepo
      .createQueryBuilder('f')
      .innerJoin('assets', 'a', 'a.id = f."assetId"')
      .select('COUNT(DISTINCT f."assetId")')
      .where('f."personId" = :personId', { personId: id })
      .andWhere('f."userId" = :userId', { userId })
      .andWhere('a."isTrashed" = :isTrashed', { isTrashed: false })
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

  // ponytail: worker cluster job applies its whole plan atomically; re-running after a success is a
  // no-op because the worker re-derives the plan and only sends unassigned faces
  async applyClusters(
    userId: string,
    dto: ApplyClustersDto,
  ): Promise<{ created: number; assigned: number }> {
    const items = [...dto.creates, ...dto.attaches]
    const totalFaces = items.reduce((sum, item) => sum + item.faceIds.length, 0)
    if (totalFaces > 5000) throw new BadRequestException('Too many faces (max 5000)')
    for (const item of items) {
      if (item.coverFaceId && !item.faceIds.includes(item.coverFaceId)) {
        throw new BadRequestException('coverFaceId must be one of the item faceIds')
      }
    }

    const allFaceIds = [...new Set(items.flatMap((item) => item.faceIds))]
    const attachPersonIds = [...new Set(dto.attaches.map((a) => a.personId))]

    return this.dataSource.transaction(async (em) => {
      const faces = allFaceIds.length
        ? await em.find(Face, { where: { id: In(allFaceIds), userId } })
        : []
      if (faces.length !== allFaceIds.length) throw new NotFoundException('Face not found')

      const attachPersons = attachPersonIds.length
        ? await em.find(Person, { where: { id: In(attachPersonIds), userId } })
        : []
      if (attachPersons.length !== attachPersonIds.length) {
        throw new NotFoundException('Person not found')
      }

      const createdPersons = dto.creates.length
        ? await em.save(
            dto.creates.map((c) =>
              em.create(Person, { userId, name: null, clusterLabel: c.clusterLabel, faceCount: 0 }),
            ),
          )
        : []

      const faceById = new Map(faces.map((f) => [f.id, f]))
      const touchedPersonIds = new Set<string>()
      const assignFace = (faceId: string, personId: string) => {
        const face = faceById.get(faceId)!
        if (face.personId && face.personId !== personId) touchedPersonIds.add(face.personId)
        face.personId = personId
        touchedPersonIds.add(personId)
      }
      dto.creates.forEach((c, i) =>
        c.faceIds.forEach((fid) => assignFace(fid, createdPersons[i]!.id)),
      )
      dto.attaches.forEach((a) => a.faceIds.forEach((fid) => assignFace(fid, a.personId)))
      if (faces.length) await em.save(faces)

      for (const [i, c] of dto.creates.entries()) {
        if (c.coverFaceId) {
          await em.update(
            Person,
            { id: createdPersons[i]!.id, userId },
            { coverFaceId: c.coverFaceId },
          )
        }
      }
      for (const a of dto.attaches) {
        if (a.coverFaceId) {
          await em.update(Person, { id: a.personId, userId }, { coverFaceId: a.coverFaceId })
        }
      }

      for (const pid of touchedPersonIds) {
        await refreshPersonFaceCount(em.getRepository(Face), em.getRepository(Person), pid, userId)
      }

      return { created: createdPersons.length, assigned: allFaceIds.length }
    })
  }

  private toListItem(person: {
    id: string
    userId: string
    name: string | null
    coverFaceId: string | null
    clusterLabel: string | null
    faceCount: number
    createdAt: Date | string
    updatedAt: Date | string
  }): PersonDto {
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
