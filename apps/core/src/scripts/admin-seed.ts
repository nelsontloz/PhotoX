// Raw-SQL admin writers shared by the boot seed (database.module.ts) and the admin:create
// CLI. Deliberately entity-free: the CLI runs under tsx (esbuild emits no decorator
// metadata), so it can only use a bare DataSource.
import { randomUUID } from 'node:crypto'
import { DataSource } from 'typeorm'
import { hashPassword } from '../users/password'
import { postgresConnectionOptions } from './postgres-options'

/** Insert one admin row with an argon2 hash (the boot seed and the CLI differ only in label). */
export async function insertAdminUser(
  ds: Pick<DataSource, 'query'>,
  email: string,
  password: string,
  displayName = 'Administrator',
): Promise<void> {
  await ds.query(
    `INSERT INTO users (id, email, role, "passwordHash", "displayName") ` +
      `VALUES ($1, $2, 'admin', $3, $4)`,
    [randomUUID(), email, await hashPassword(password), displayName],
  )
}

/**
 * Bare DataSource for operator scripts: no entities and no synchronize — read/update only,
 * never DDL (core owns the schema). Same connection options as DatabaseModule.forRoot,
 * minus the ORM machinery.
 */
export function createScriptDataSource(): DataSource {
  return new DataSource(postgresConnectionOptions())
}
