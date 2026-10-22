import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GenericContainer } from 'testcontainers'

// ponytail: one shared Redis container for the whole vitest run instead of one per spec file
// (10 spec files => 10 containers). Every spec file claims its own logical database (index)
// so BullMQ keys and rate-limit buckets stay file-local. Ceiling: the container runs with
// --databases 256, so at most 256 spec files can run in one invocation. Upgrade path: a real
// Redis cluster, or per-file containers again, when DB-level isolation stops being enough.
const REDIS_DATABASES = 256

// vitest 3.2 has no globalTeardown option — the teardown is the function this returns
export default async function setup(): Promise<() => Promise<void>> {
  const container = await new GenericContainer('redis:7-alpine')
    .withCommand(['redis-server', '--databases', String(REDIS_DATABASES)])
    .withExposedPorts(6379)
    .start()

  // cross-process slot registry: a spec file claims an index with an O_EXCL create, so two
  // files can never end up on the same Redis database
  const slotsDir = mkdtempSync(join(tmpdir(), 'photox-worker-slots-'))

  process.env.REDIS_HOST = container.getHost()
  process.env.REDIS_PORT = String(container.getMappedPort(6379))
  process.env.PHOTOX_TEST_SLOTS_DIR = slotsDir

  return async () => {
    await container.stop()
    rmSync(slotsDir, { recursive: true, force: true })
  }
}
