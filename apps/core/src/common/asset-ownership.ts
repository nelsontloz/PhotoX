import { NotFoundException } from '@nestjs/common';
import type { FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import { isPostgresCode } from './sql-errors';

/** Postgres `invalid input syntax for type uuid` — a malformed path id, not a server fault. */
function isInvalidUuidError(err: unknown): boolean {
  return isPostgresCode(err, '22P02');
}

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
  try {
    const row = await repo.findOne({ where: { id, userId } as FindOptionsWhere<T> });
    if (!row) throw new NotFoundException(`${label} not found`);
    return row;
  } catch (err) {
    // a non-UUID id must read as missing, not surface the uuid cast as a 500
    if (isInvalidUuidError(err)) throw new NotFoundException(`${label} not found`);
    throw err;
  }
}
