import { randomBytes } from 'node:crypto'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

let redis: StartedTestContainer | null = null

export async function setupRedis(): Promise<{ redisHost: string; redisPort: number }> {
  const hash = randomBytes(3).toString('hex')

  redis = await new GenericContainer('redis:7-alpine')
    .withName(`redis-${hash}`)
    .withExposedPorts(6379)
    .start()

  const redisHost = redis.getHost()
  const redisPort = redis.getMappedPort(6379)

  process.env.REDIS_HOST = redisHost
  process.env.REDIS_PORT = String(redisPort)

  return { redisHost, redisPort }
}

export async function teardownRedis(): Promise<void> {
  if (redis) {
    await redis.stop()
    redis = null
  }
}
