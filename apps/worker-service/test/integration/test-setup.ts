import { randomBytes } from 'node:crypto'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

let container: StartedTestContainer | null = null

export async function setupTestInfra() {
  const hash = randomBytes(3).toString('hex')

  const redis = await new GenericContainer('redis:7-alpine')
    .withName(`redis-${hash}`)
    .withExposedPorts(6379)
    .start()

  container = redis

  const host = redis.getHost()
  const port = redis.getMappedPort(6379)

  process.env.REDIS_HOST = host
  process.env.REDIS_PORT = String(port)

  return { redisHost: host, redisPort: port }
}

export async function teardownTestInfra() {
  if (container) {
    await container.stop()
    container = null
  }
}
