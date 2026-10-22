import { GenericContainer } from 'testcontainers'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * One Postgres + one Redis container for the whole core integration run.
 *
 * Isolation used to come from the container itself (one container per spec file, ~80
 * containers per run). It now comes from inside the shared containers:
 *   - Postgres: each spec file clones TEMPLATE_DB into a private database, so the
 *     pgvector extensions are present without a per-file psql round trip.
 *   - Redis: each spec file claims a private logical DB index, so flushdb() and the
 *     rate-limit buckets stay file-local.
 */
export const TEMPLATE_DB = 'photox_tmpl'

export default async function setup() {
  const slotsDir = mkdtempSync(join(tmpdir(), 'photox-core-slots-'))

  const redis = await new GenericContainer('redis:7-alpine')
    // 256 logical DBs — one per spec file (MAX_SLOTS in test/integration/test-setup.ts)
    .withCommand(['redis-server', '--databases', '256'])
    .withExposedPorts(6379)
    .start()

  const postgres = await new GenericContainer('pgvector/pgvector:0.8.7-pg16')
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: 'photox',
      POSTGRES_PASSWORD: 'photox',
      POSTGRES_DB: 'photox',
    })
    .start()

  // The template carries the extensions; every per-file database is a clone of it.
  // Nothing may hold a connection to the template while a clone is in flight.
  await postgres.exec([
    'psql',
    '-U',
    'photox',
    '-d',
    'postgres',
    '-c',
    `CREATE DATABASE ${TEMPLATE_DB}`,
  ])
  await postgres.exec([
    'psql',
    '-U',
    'photox',
    '-d',
    TEMPLATE_DB,
    '-c',
    'CREATE EXTENSION IF NOT EXISTS vector',
    '-c',
    'CREATE EXTENSION IF NOT EXISTS cube',
    '-c',
    'CREATE EXTENSION IF NOT EXISTS earthdistance',
  ])

  // Published to the workers: vitest forks inherit the main process env, and every
  // spec file runs in its own process, so per-file mutations stay file-local.
  process.env.POSTGRES_HOST = postgres.getHost()
  process.env.POSTGRES_PORT = String(postgres.getMappedPort(5432))
  process.env.POSTGRES_USER = 'photox'
  process.env.POSTGRES_PASSWORD = 'photox'
  process.env.REDIS_HOST = redis.getHost()
  process.env.REDIS_PORT = String(redis.getMappedPort(6379))
  process.env.PHOTOX_TEST_SLOTS_DIR = slotsDir

  return async () => {
    await postgres.stop()
    await redis.stop()
    rmSync(slotsDir, { recursive: true, force: true })
  }
}
