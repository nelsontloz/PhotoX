import type { Repository } from 'typeorm'
import { Face } from '../database/entities'
import { Person } from '../database/entities'

// ponytail: one shared non-trashed count (faces on non-trashed assets only)
export async function countLiveFaces(
  faceRepo: Repository<Face>,
  personId: string,
  userId: string,
): Promise<number> {
  const result = await faceRepo
    .createQueryBuilder('f')
    .innerJoin('assets', 'a', 'a.id = f."assetId"')
    .select('COUNT(*)')
    .where('f."personId" = :personId', { personId })
    .andWhere('f."userId" = :userId', { userId })
    .andWhere('a."isTrashed" = :isTrashed', { isTrashed: false })
    .getRawOne<{ count: string }>()
  return Number(result?.count ?? 0)
}

// ponytail: pass `em.getRepository(...)` from transactional callers so the refresh stays inside
// the transaction
export async function refreshPersonFaceCount(
  faceRepo: Repository<Face>,
  personRepo: Repository<Person>,
  personId: string,
  userId: string,
): Promise<void> {
  const faceCount = await countLiveFaces(faceRepo, personId, userId)
  await personRepo.update({ id: personId, userId }, { faceCount })
}
