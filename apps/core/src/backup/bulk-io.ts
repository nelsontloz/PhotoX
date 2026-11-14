import type {
  DeepPartial,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  QueryDeepPartialEntity,
} from 'typeorm';

/**
 * Rows per bulk INSERT: Postgres rejects a statement with more than 65,535 bind parameters, and
 * TypeORM only splits when `chunk` is set (Asset alone binds ~47 columns per row).
 */
export const BULK_CHUNK = 500;

/** Splits a list into fixed-size groups — one statement per group stays under the bind cap. */
export function chunked<T>(items: T[], size = 1000): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** One bulk save that always chunks; an empty input is a no-op. */
export async function bulkSave<Entity>(
  manager: EntityManager,
  entity: EntityTarget<Entity>,
  rows: DeepPartial<Entity>[],
): Promise<void> {
  await manager.save(entity, rows, { chunk: BULK_CHUNK });
}

/** One bulk insert that always chunks; an empty input issues no statement. */
export async function bulkInsert<Entity extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<Entity>,
  rows: QueryDeepPartialEntity<Entity>[],
): Promise<void> {
  for (const group of chunked(rows, BULK_CHUNK)) await manager.insert(entity, group);
}

/**
 * TypeORM's Postgres driver returns UPDATE/DELETE results as `[rows, affected]`; SELECTs return
 * the rows directly. Normalize both so a claim/finalize query reads the same way.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}
