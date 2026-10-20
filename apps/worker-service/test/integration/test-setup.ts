import { randomBytes } from 'node:crypto'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { TEST_AUTH_SECRET, TEST_WORKER_SECRET } from '../sign-job'

// mirror apps/core/test/integration/test-setup.ts — the worker verifies job sigs against the
// same secret core stamps, so the harness configures it before processors boot
export { TEST_AUTH_SECRET, TEST_WORKER_SECRET }

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
  process.env.AUTH_TOKEN_SECRET = TEST_AUTH_SECRET
  process.env.WORKER_JWT_SECRET = TEST_WORKER_SECRET

  return { redisHost, redisPort }
}

export async function teardownRedis(): Promise<void> {
  if (redis) {
    await redis.stop()
    redis = null
  }
}
