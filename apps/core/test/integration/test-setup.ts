import { randomBytes } from 'node:crypto'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

export const TEST_AUTH_SECRET = '0123456789abcdef0123456789abcdef'

let redis: StartedTestContainer | null = null
let postgres: StartedTestContainer | null = null

export async function setupTestInfra() {
  const hash = randomBytes(3).toString('hex')

  redis = await new GenericContainer('redis:7-alpine')
    .withName(`api-redis-${hash}`)
    .withExposedPorts(6379)
    .start()

  postgres = await new GenericContainer('pgvector/pgvector:0.8.7-pg16')
    .withName(`api-pg-${hash}`)
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: 'photox',
      POSTGRES_PASSWORD: 'photox',
      POSTGRES_DB: 'photox',
    })
    .start()

  // search ANN casts to halfvec — the extension must exist before any query runs (core's
  // VECTOR_INIT bootstrap is not part of the test app's module graph); cube/earthdistance back
  // the places reverse-geocoding KNN query
  await postgres.exec([
    'psql',
    '-U',
    'photox',
    '-d',
    'photox',
    '-c',
    'CREATE EXTENSION IF NOT EXISTS vector',
    '-c',
    'CREATE EXTENSION IF NOT EXISTS cube',
    '-c',
    'CREATE EXTENSION IF NOT EXISTS earthdistance',
  ])

  const redisHost = redis.getHost()
  const redisPort = redis.getMappedPort(6379)
  const pgHost = postgres.getHost()
  const pgPort = postgres.getMappedPort(5432)

  process.env.REDIS_HOST = redisHost
  process.env.REDIS_PORT = String(redisPort)
  process.env.POSTGRES_HOST = pgHost
  process.env.POSTGRES_PORT = String(pgPort)
  process.env.POSTGRES_USER = 'photox'
  process.env.POSTGRES_PASSWORD = 'photox'
  process.env.AUTH_TOKEN_SECRET = TEST_AUTH_SECRET

  return { redisHost, redisPort, pgHost, pgPort }
}

/** Stops only the Redis container, e.g. for degraded-health tests. */
export async function stopRedisContainer() {
  if (redis) await redis.stop()
}

export async function teardownTestInfra() {
  if (redis) {
    try {
      // testcontainers' stop() is cached per instance, but be tolerant if the
      // container was already stopped/removed elsewhere (degraded-health test)
      await redis.stop()
    } catch {
      // already stopped — nothing to clean up
    }
    redis = null
  }
  if (postgres) {
    await postgres.stop()
    postgres = null
  }
}
