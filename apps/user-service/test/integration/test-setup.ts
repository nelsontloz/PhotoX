import { randomBytes } from 'node:crypto'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

interface TestInfra {
  pgHost: string
  pgPort: number
  redisHost: string
  redisPort: number
}

let pgContainer: StartedTestContainer | null = null
let redisContainer: StartedTestContainer | null = null

export async function setupTestInfra(): Promise<TestInfra> {
  const hash = randomBytes(3).toString('hex')

  const pg = await new GenericContainer('postgres:16-alpine')
    .withName(`postgres-${hash}`)
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'users_db',
    })
    .withExposedPorts(5432)
    .start()

  const redis = await new GenericContainer('redis:7-alpine')
    .withName(`redis-${hash}`)
    .withExposedPorts(6379)
    .start()

  pgContainer = pg
  redisContainer = redis

  const infra: TestInfra = {
    pgHost: pg.getHost(),
    pgPort: pg.getMappedPort(5432),
    redisHost: redis.getHost(),
    redisPort: redis.getMappedPort(6379),
  }

  process.env.NODE_ENV = 'test'
  process.env.POSTGRES_HOST = infra.pgHost
  process.env.POSTGRES_PORT = String(infra.pgPort)
  process.env.POSTGRES_USER = 'test'
  process.env.POSTGRES_PASSWORD = 'test'
  process.env.REDIS_HOST = infra.redisHost
  process.env.REDIS_PORT = String(infra.redisPort)

  return infra
}

export async function teardownTestInfra(): Promise<void> {
  if (pgContainer) {
    await pgContainer.stop()
    pgContainer = null
  }
  if (redisContainer) {
    await redisContainer.stop()
    redisContainer = null
  }
}
