import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

interface TestInfra {
  pgHost: string
  pgPort: number
  minioHost: string
  minioPort: number
}

let pgContainer: StartedTestContainer | null = null
let minioContainer: StartedTestContainer | null = null

export async function setupTestInfra(): Promise<TestInfra> {
  const hash = randomBytes(3).toString('hex')

  const pg = await new GenericContainer('postgres:16-alpine')
    .withName(`postgres-${hash}`)
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'files_db',
    })
    .withExposedPorts(5432)
    .start()

  pgContainer = pg

  const minio = await new GenericContainer('minio/minio:RELEASE.2025-09-07T16-13-09Z')
    .withName(`minio-${hash}`)
    .withEnvironment({
      MINIO_ROOT_USER: 'test',
      MINIO_ROOT_PASSWORD: 'testtest',
    })
    .withCommand(['server', '/data', '--console-address', ':9001'])
    .withExposedPorts(9000)
    .withStartupTimeout(120_000)
    .withWaitStrategy(Wait.forListeningPorts())
    .start()

  minioContainer = minio

  let minioPort: number
  try {
    minioPort = minio.getMappedPort(9000)
  } catch (err) {
    try {
      const name = minio.getName()
      const logs = execSync(`docker logs ${name} 2>&1`, {
        encoding: 'utf8',
        timeout: 5000,
      })
      console.error('=== MinIO container logs (crashed) ===')
      console.error(logs)
      console.error('======================================')
    } catch (logsErr) {
      console.error('Failed to capture MinIO logs:', logsErr)
    }
    throw err
  }

  const infra: TestInfra = {
    pgHost: pg.getHost(),
    pgPort: pg.getMappedPort(5432),
    minioHost: minio.getHost(),
    minioPort,
  }

  process.env.NODE_ENV = 'test'
  process.env.POSTGRES_HOST = infra.pgHost
  process.env.POSTGRES_PORT = String(infra.pgPort)
  process.env.POSTGRES_USER = 'test'
  process.env.POSTGRES_PASSWORD = 'test'
  process.env.MINIO_ENDPOINT = infra.minioHost
  process.env.MINIO_PORT = String(infra.minioPort)
  process.env.MINIO_ROOT_USER = 'test'
  process.env.MINIO_ROOT_PASSWORD = 'testtest'

  return infra
}

export async function teardownTestInfra(): Promise<void> {
  if (minioContainer) {
    await minioContainer.stop()
    minioContainer = null
  }
  if (pgContainer) {
    await pgContainer.stop()
    pgContainer = null
  }
}

export async function stopMinioContainer(): Promise<void> {
  if (minioContainer) {
    await minioContainer.stop()
    minioContainer = null
  }
}
