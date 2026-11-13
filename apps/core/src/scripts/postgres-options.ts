import { loadEnv } from '@photox/shared-config';

/**
 * POSTGRES_* connection block + the single hardcoded `photox` database, shared by core's
 * DatabaseModule and the operator scripts (which differ only in ORM extras).
 */
export function postgresConnectionOptions() {
  const env = loadEnv();
  return {
    type: 'postgres' as const,
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: 'photox',
    // ponytail: node-postgres defaults to 10 connections with no query ceiling, which is what the
    // upload session lock (held across file I/O) would exhaust first. `idle_in_transaction_session_timeout`
    // is deliberately left unset: the assembly step is legitimately "idle in transaction" for
    // minutes, so enabling it there would kill uploads until the lock scope is narrowed.
    extra: {
      max: 20,
      statement_timeout: 60_000,
      connectionTimeoutMillis: 5_000,
    },
  };
}
