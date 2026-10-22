import { closeSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { DataSource } from 'typeorm'

export const TEST_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
export const TEST_AUTH_SECRET_PREVIOUS = 'previous-test-secret-0123456789abcd'
export const TEST_WORKER_SECRET = 'worker-test-secret-9f8e7d6c5b4a3210'

/**
 * Template database built by the global setup — carries the pgvector extensions *and* the
 * full schema, so a per-file clone needs no DDL at all.
 */
export const TEMPLATE_DB = 'photox_tmpl'
/** Must stay below the shared Redis container's `--databases 256`. */
const MAX_SLOTS = 200

export interface TestInfra {
  pgHost: string
  pgPort: number
  /** Private database for this spec file, inside the shared Postgres container. */
  pgDb: string
  redisHost: string
  redisPort: number
  /** Private Redis logical DB index for this spec file. */
  redisDb: number
}

let infra: TestInfra | null = null

/**
 * Claims a slot index no other spec file in this run holds. The claim file is created
 * with O_EXCL, so two files racing for the same index cannot both win it. Slots are
 * never released: a spec file keeps its database and its Redis DB for the whole run,
 * which is what the old one-container-per-file setup gave us.
 */
function claimSlot(): number {
  const dir = process.env.PHOTOX_TEST_SLOTS_DIR
  if (!dir) throw new Error('PHOTOX_TEST_SLOTS_DIR is not set — the global setup did not run')
  for (let index = 0; index < MAX_SLOTS; index++) {
    try {
      closeSync(openSync(join(dir, `slot-${index}.claim`), 'wx'))
      return index
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`no free test slot left (MAX_SLOTS=${MAX_SLOTS})`)
}

/** Admin connection to the container — `database` is where the statements run. */
export async function withAdminDb<T>(
  pgHost: string,
  pgPort: number,
  database: string,
  fn: (ds: DataSource) => Promise<T>,
): Promise<T> {
  const ds = new DataSource({
    type: 'postgres',
    host: pgHost,
    port: pgPort,
    username: 'photox',
    password: 'photox',
    database,
  })
  await ds.initialize()
  try {
    return await fn(ds)
  } finally {
    await ds.destroy()
  }
}

/**
 * Per-spec-file infrastructure inside the shared containers: a private Postgres database
 * (cloned from the template, so extensions *and* schema come for free) plus a private Redis
 * logical database. The containers themselves are owned by the global setup.
 */
export async function setupTestInfra(): Promise<TestInfra> {
  if (infra) return infra
  const pgHost = process.env.POSTGRES_HOST ?? 'localhost'
  const pgPort = Number(process.env.POSTGRES_PORT ?? 5432)
  const redisHost = process.env.REDIS_HOST ?? 'localhost'
  const redisPort = Number(process.env.REDIS_PORT ?? 6379)
  const redisDb = claimSlot()
  const pgDb = `photox_t_s${redisDb}`

  await withAdminDb(pgHost, pgPort, 'photox', async (ds) => {
    await ds.query(`CREATE DATABASE "${pgDb}" TEMPLATE "${TEMPLATE_DB}"`)
  })

  process.env.AUTH_TOKEN_SECRET = TEST_AUTH_SECRET
  process.env.WORKER_JWT_SECRET = TEST_WORKER_SECRET
  process.env.REDIS_DB = String(redisDb)
  // the shared test Redis is passwordless — a REDIS_PASSWORD inherited from the shell
  // or from .env would break every connection
  delete process.env.REDIS_PASSWORD

  infra = { pgHost, pgPort, pgDb, redisHost, redisPort, redisDb }
  return infra
}

/** Drops this spec file's database. The containers are stopped once by the global setup. */
export async function teardownTestInfra(): Promise<void> {
  if (!infra) return
  const { pgHost, pgPort, pgDb } = infra
  infra = null
  await withAdminDb(pgHost, pgPort, 'photox', async (ds) => {
    await ds.query(`DROP DATABASE IF EXISTS "${pgDb}" WITH (FORCE)`)
  })
}
