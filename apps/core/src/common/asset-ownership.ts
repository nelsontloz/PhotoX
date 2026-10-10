import { NotFoundException } from '@nestjs/common'
import type { FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm'

/**
 * Returns the row when it exists and belongs to the user; 404s otherwise (missing and
 * other-user rows are indistinguishable). `label` is the entity name in the 404 message.
 */
export async function findOwnedOr404<T extends ObjectLiteral & { id: string; userId: string }>(
  repo: Repository<T>,
  id: string,
  userId: string,
  label: string,
): Promise<T> {
  const row = await repo.findOne({ where: { id, userId } as FindOptionsWhere<T> })
  if (!row) throw new NotFoundException(`${label} not found`)
  return row
}
