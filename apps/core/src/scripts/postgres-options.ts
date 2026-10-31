import { loadEnv } from '@photox/shared-config'

/**
 * POSTGRES_* connection block + the single hardcoded `photox` database, shared by core's
 * DatabaseModule and the operator scripts (which differ only in ORM extras).
 */
export function postgresConnectionOptions() {
  const env = loadEnv()
  return {
    type: 'postgres' as const,
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: 'photox',
  }
}
