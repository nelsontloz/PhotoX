import type { Repository } from 'typeorm'
import { Face } from '@photox/data-access'
import { Person } from '@photox/data-access'

// ponytail: one shared non-trashed count (faces on non-trashed assets only); pass `em.getRepository(...)`
// from transactional callers so the refresh stays inside the transaction
export async function refreshPersonFaceCount(
  faceRepo: Repository<Face>,
  personRepo: Repository<Person>,
  personId: string,
  userId: string,
): Promise<void> {
  const result = await faceRepo
    .createQueryBuilder('f')
    .innerJoin('assets', 'a', 'a.id = f."assetId"')
    .select('COUNT(*)')
    .where('f."personId" = :personId', { personId })
    .andWhere('f."userId" = :userId', { userId })
    .andWhere('a."isTrashed" = :isTrashed', { isTrashed: false })
    .getRawOne<{ count: string }>()
  await personRepo.update({ id: personId, userId }, { faceCount: Number(result?.count ?? 0) })
}
