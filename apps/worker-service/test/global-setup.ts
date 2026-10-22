import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Redis } from 'ioredis'
import { GenericContainer } from 'testcontainers'

// ponytail: one shared Redis container for the whole vitest run instead of one per spec file
// (10 spec files => 10 containers). Every spec file claims its own logical database (index)
// so BullMQ keys and rate-limit buckets stay file-local. Ceiling: the container runs with
// --databases 256, so at most 256 spec files can run in one invocation, and the container is
// reused across runs (not Ryuk-reaped) — a second concurrent run of this package against the
// same container would share the keyspace. Upgrade path: a real Redis cluster, or per-file
// containers again, when DB-level isolation stops being enough.
const REDIS_DATABASES = 256

/**
 * testcontainers only skips reuse when this is exactly 'false', and a reused container is
 * never registered with Ryuk — mirror the same gate so the teardown knows whether this
 * container is meant to outlive the run.
 */
const reuseEnabled = process.env.TESTCONTAINERS_REUSE_ENABLE !== 'false'

// vitest 3.2 has no globalTeardown option — the teardown is the function this returns
export default async function setup(): Promise<() => Promise<void>> {
  const container = await new GenericContainer('redis:7-alpine')
    .withReuse()
    .withLabels({ 'photox.test': 'worker-redis' })
    .withCommand(['redis-server', '--databases', String(REDIS_DATABASES)])
    .withExposedPorts(6379)
    .start()

  // cross-process slot registry: a spec file claims an index with an O_EXCL create, so two
  // files can never end up on the same Redis database
  const slotsDir = mkdtempSync(join(tmpdir(), 'photox-worker-slots-'))

  // A reused container still holds the previous run's keys (its teardown may never have run),
  // so flush every logical DB before handing any of them out.
  await wipe(container.getHost(), container.getMappedPort(6379))

  process.env.REDIS_HOST = container.getHost()
  process.env.REDIS_PORT = String(container.getMappedPort(6379))
  process.env.PHOTOX_TEST_SLOTS_DIR = slotsDir

  return async () => {
    rmSync(slotsDir, { recursive: true, force: true })
    // A reused container stays up so the next run skips the start; only a run that opted out
    // of reuse owns (and must remove) its container.
    if (reuseEnabled) return
    try {
      await container.stop()
    } catch {
      // already stopped/removed — nothing to clean up
    }
  }
}

/** `flushall` rather than 256 `flushdb`s: every logical DB belongs to this suite. */
async function wipe(host: string, port: number): Promise<void> {
  const client = new Redis({ host, port })
  client.on('error', () => undefined)
  try {
    await client.flushall()
  } finally {
    client.disconnect()
  }
}
