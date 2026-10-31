import { closeSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { TEST_AUTH_SECRET, TEST_WORKER_SECRET } from '../sign-job'

// mirror apps/core/test/integration/test-setup.ts — the worker verifies job sigs against the
// same secret core stamps, so the harness configures it before processors boot
export { TEST_AUTH_SECRET, TEST_WORKER_SECRET }

// ponytail: the Redis container is shared by the whole vitest run (test/global-setup.ts) and
// every spec file claims its own logical database index, so no two files share a keyspace.
// Ceiling: MAX_SLOTS databases — the container must run with --databases 256, so the index
// space stays well below the container's. Upgrade path: a Redis cluster, or a container per
// file again, when DB-level isolation stops being enough.
const MAX_SLOTS = 200

// vitest gives every spec file a fresh module registry, so this memo is naturally file-local
let claimedSlot: number | null = null

function claimSlot(): number {
  const dir = process.env.PHOTOX_TEST_SLOTS_DIR
  if (!dir) throw new Error('PHOTOX_TEST_SLOTS_DIR missing — globalSetup did not run')
  for (let n = 0; n < MAX_SLOTS; n++) {
    try {
      const fd = openSync(join(dir, `slot-${n}.claim`), 'wx') // O_EXCL => atomic
      closeSync(fd)
      return n
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`no free test slot (MAX_SLOTS=${MAX_SLOTS})`)
}

export function setupRedis(): void {
  const redisHost = process.env.REDIS_HOST
  const redisPort = process.env.REDIS_PORT
  if (!redisHost || !redisPort) {
    throw new Error('REDIS_HOST/REDIS_PORT missing — globalSetup did not run')
  }

  claimedSlot ??= claimSlot()

  process.env.REDIS_DB = String(claimedSlot)
  // the shared test Redis is passwordless — a developer/CI REDIS_PASSWORD would break every spec
  delete process.env.REDIS_PASSWORD
  process.env.AUTH_TOKEN_SECRET = TEST_AUTH_SECRET
  process.env.WORKER_JWT_SECRET = TEST_WORKER_SECRET
}
