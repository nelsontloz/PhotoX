import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { GenericContainer } from 'testcontainers';

// ponytail: one shared Redis container for the whole vitest run instead of one per spec file
// (10 spec files => 10 containers). Every spec file claims its own logical database (index)
// so BullMQ keys and rate-limit buckets stay file-local. Ceiling: the container runs with
// --databases 256, so at most 256 spec files can run in one invocation, and the container is
// session-owned (Ryuk reaps it if the run is killed, the teardown below stops it on success)
// — a second concurrent run of this package gets its own container instead of sharing a
// keyspace. Upgrade path: a real Redis cluster, or per-file containers again, when DB-level
// isolation stops being enough.
const REDIS_DATABASES = 256;

// vitest has no globalTeardown option — the teardown is the function this returns
export default async function setup(): Promise<() => Promise<void>> {
  const container = await new GenericContainer('redis:7-alpine')
    .withLabels({ 'photox.test': 'worker-redis' })
    .withCommand(['redis-server', '--databases', String(REDIS_DATABASES)])
    .withExposedPorts(6379)
    .start();

  // cross-process slot registry: a spec file claims an index with an O_EXCL create, so two
  // files can never end up on the same Redis database
  const slotsDir = mkdtempSync(join(tmpdir(), 'photox-worker-slots-'));

  // The container is fresh, so this is a guard rather than a repair: it keeps the harness safe
  // if it is ever pointed at a long-lived container.
  await wipe(container.getHost(), container.getMappedPort(6379));

  process.env.REDIS_HOST = container.getHost();
  process.env.REDIS_PORT = String(container.getMappedPort(6379));
  process.env.PHOTOX_TEST_SLOTS_DIR = slotsDir;

  return async () => {
    rmSync(slotsDir, { recursive: true, force: true });
    // Session-owned: stop it so a finished run leaves nothing behind (a killed run is reaped
    // by Ryuk instead).
    try {
      await container.stop();
    } catch {
      // already stopped/removed — nothing to clean up
    }
  };
}

/** `flushall` rather than 256 `flushdb`s: every logical DB belongs to this suite. */
async function wipe(host: string, port: number): Promise<void> {
  const client = new Redis({ host, port });
  client.on('error', () => undefined);
  try {
    await client.flushall();
  } finally {
    client.disconnect();
  }
}
