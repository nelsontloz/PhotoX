import { randomBytes } from 'node:crypto'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

let redis: StartedTestContainer | null = null
let postgres: StartedTestContainer | null = null

export async function setupTestInfra() {
  const hash = randomBytes(3).toString('hex')

  redis = await new GenericContainer('redis:7-alpine')
    .withName(`redis-${hash}`)
    .withExposedPorts(6379)
    .start()

  postgres = await new GenericContainer('postgres:16-alpine')
    .withName(`pg-${hash}`)
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: 'photox',
      POSTGRES_PASSWORD: 'photox',
      POSTGRES_DB: 'photox',
    })
    .start()

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

  return { redisHost, redisPort, pgHost, pgPort }
}

export async function teardownTestInfra() {
  if (redis) {
    await redis.stop()
    redis = null
  }
  if (postgres) {
    await postgres.stop()
    postgres = null
  }
}
