import type { EntityManager } from 'typeorm'
import { Face } from '../database/entities'
import { Person } from '../database/entities'
import { refreshPersonFaceCount } from '../faces/face-count'

/**
 * Repairs the persons that owned `faces` after those faces were deleted: nulls a cover pointing
 * at a deleted face and refreshes the live faceCount. The caller owns the transaction and the
 * face delete itself. `userId` scopes person lookups on paths that already enforce ownership.
 */
export async function refreshPersonsAfterFaceDelete(
  em: EntityManager,
  faces: Face[],
  userId?: string,
): Promise<void> {
  if (faces.length === 0) return
  const deletedFaceIds = new Set(faces.map((f) => f.id))
  const personIds = [
    ...new Set(faces.map((f) => f.personId).filter((p): p is string => p !== null)),
  ]
  for (const pid of personIds) {
    const person = await em.findOne(Person, {
      where: userId ? { id: pid, userId } : { id: pid },
    })
    if (!person) continue
    if (person.coverFaceId && deletedFaceIds.has(person.coverFaceId)) {
      await em.update(Person, userId ? { id: pid, userId } : { id: pid }, { coverFaceId: null })
    }
    await refreshPersonFaceCount(
      em.getRepository(Face),
      em.getRepository(Person),
      pid,
      person.userId,
    )
  }
}
