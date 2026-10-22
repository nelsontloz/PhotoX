import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Redis } from 'ioredis'
import { DataSource } from 'typeorm'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { ENTITIES } from './integration/entities'
import { TEMPLATE_DB, withAdminDb } from './integration/test-setup'

/**
 * One Postgres + one Redis container for the whole core integration run, reused across runs.
 *
 * Isolation used to come from the container itself (one pair per spec file, ~80 containers per
 * run). It now comes from inside the shared containers:
 *   - Postgres: each spec file clones TEMPLATE_DB into a private database. The template carries
 *     the pgvector extensions *and* the schema (baked from the entity metadata below), so a
 *     clone needs no DDL — the spec app runs with `synchronize: false`.
 *   - Redis: each spec file claims a private logical DB index, so flushdb() and the
 *     rate-limit buckets stay file-local.
 *
 * The containers are started with `withReuse()`, so a second run skips the image start
 * entirely (~1.4 s saved). That makes leftover state the harness's problem, not the
 * container's: the wipe below is what a fresh container used to give us for free.
 */

const PG_USER = 'photox'
const PG_PASSWORD = 'photox'
const REDIS_DATABASES = 256

/**
 * testcontainers only skips reuse when this is exactly 'false', and a reused container is
 * never registered with Ryuk — mirror the same gate so the teardown knows whether these
 * containers are meant to outlive the run.
 */
const reuseEnabled = process.env.TESTCONTAINERS_REUSE_ENABLE !== 'false'

export default async function setup(): Promise<() => Promise<void>> {
  const slotsDir = mkdtempSync(join(tmpdir(), 'photox-core-slots-'))

  const redis = await new GenericContainer('redis:7-alpine')
    .withReuse()
    .withLabels({ 'photox.test': 'core-redis' })
    // one logical DB per spec file (MAX_SLOTS in test/integration/test-setup.ts)
    .withCommand(['redis-server', '--databases', String(REDIS_DATABASES)])
    .withExposedPorts(6379)
    .start()

  const postgres = await new GenericContainer('pgvector/pgvector:0.8.7-pg16')
    .withReuse()
    .withLabels({ 'photox.test': 'core-postgres' })
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: PG_USER,
      POSTGRES_PASSWORD: PG_PASSWORD,
      POSTGRES_DB: 'photox',
    })
    .start()

  const pgHost = postgres.getHost()
  const pgPort = postgres.getMappedPort(5432)
  const redisHost = redis.getHost()
  const redisPort = redis.getMappedPort(6379)

  // A reused container still holds the previous run's keys and databases (its teardown may
  // never have run). Wipe both so the run starts from the state a fresh container would give.
  await wipeRedis(redisHost, redisPort)
  await dropSuiteDatabases(pgHost, pgPort)
  await bakeTemplate(pgHost, pgPort)

  // Published to the workers: vitest forks inherit the main process env, and every spec file
  // runs in its own process, so per-file mutations stay file-local.
  process.env.POSTGRES_HOST = pgHost
  process.env.POSTGRES_PORT = String(pgPort)
  process.env.POSTGRES_USER = PG_USER
  process.env.POSTGRES_PASSWORD = PG_PASSWORD
  process.env.REDIS_HOST = redisHost
  process.env.REDIS_PORT = String(redisPort)
  process.env.PHOTOX_TEST_SLOTS_DIR = slotsDir

  return async () => {
    rmSync(slotsDir, { recursive: true, force: true })
    // Reused containers stay up so the next run skips the start. Only a run that opted out of
    // reuse owns (and must remove) its containers.
    if (!reuseEnabled) {
      await stopQuietly(postgres)
      await stopQuietly(redis)
    }
  }
}

/** `flushall` rather than 256 `flushdb`s: every logical DB belongs to this suite. */
async function wipeRedis(host: string, port: number): Promise<void> {
  const client = new Redis({ host, port })
  client.on('error', () => undefined)
  try {
    await client.flushall()
  } finally {
    client.disconnect()
  }
}

/**
 * Drops every database this suite created — the template and the per-file clones. Without
 * this, a run killed before its per-file teardown would leave `photox_t_s<n>` behind and the
 * next run's clone would fail on the existing name.
 */
async function dropSuiteDatabases(pgHost: string, pgPort: number): Promise<void> {
  await withAdminDb(pgHost, pgPort, 'photox', async (ds) => {
    // `_` is a LIKE wildcard — escape it so the pattern cannot match an unrelated database
    const rows = await ds.query<{ datname: string }[]>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'photox\\_t%'",
    )
    for (const { datname } of rows) {
      await ds.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`)
    }
  })
}

/**
 * Rebuilds the template from scratch on every run: extensions first (search ANN casts to
 * halfvec, places reverse-geocoding uses the cube/earthdistance KNN operators, and core's
 * VectorInitService is not part of the test module graph), then the schema from the entity
 * metadata. Rebuilding rather than reusing is what keeps a reused container from serving a
 * stale schema after an entity change.
 */
async function bakeTemplate(pgHost: string, pgPort: number): Promise<void> {
  await withAdminDb(pgHost, pgPort, 'photox', async (ds) => {
    await ds.query(`CREATE DATABASE "${TEMPLATE_DB}"`)
  })
  await withAdminDb(pgHost, pgPort, TEMPLATE_DB, async (ds) => {
    await ds.query('CREATE EXTENSION IF NOT EXISTS vector')
    await ds.query('CREATE EXTENSION IF NOT EXISTS cube')
    await ds.query('CREATE EXTENSION IF NOT EXISTS earthdistance')
  })

  // Same entities and same synchronize path the spec apps used to run per file — the clone is
  // byte-identical to what a per-file `synchronize: true` produced.
  const ds = new DataSource({
    type: 'postgres',
    host: pgHost,
    port: pgPort,
    username: PG_USER,
    password: PG_PASSWORD,
    database: TEMPLATE_DB,
    entities: ENTITIES,
    synchronize: true,
  })
  await ds.initialize()
  await ds.destroy()
}

async function stopQuietly(container: StartedTestContainer): Promise<void> {
  try {
    await container.stop()
  } catch {
    // already stopped/removed — nothing to clean up
  }
}
