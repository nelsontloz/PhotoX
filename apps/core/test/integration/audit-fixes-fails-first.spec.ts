import request from 'supertest';
import sharp from 'sharp';
import { vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ACCESS_COOKIE } from '../../src/auth/auth-cookie';
import { BullMqService } from '../../src/queue/bullmq.service';
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedThumbnail,
  seedUser,
} from './helpers';
import type { ApiTestApp } from './helpers';
import { TEST_AUTH_SECRET } from './test-setup';
import type { User } from '../../src/users/entities/user.entity';

// One red test per audit finding ("Fix first" 1-5). They assert the intended contract and are
// expected to fail until the fix lands; delete each block as its fix merges, then this file goes.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function auth(t: ApiTestApp, user: User): Record<string, string> {
  return t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));
}

async function adminAuth(t: ApiTestApp): Promise<Record<string, string>> {
  return auth(t, await seedUser(t, { role: 'admin' }));
}

async function pngBytes(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
}

/** Session row + one received chunk on disk, as a real in-flight upload would leave them. */
async function seedInFlightSession(t: ApiTestApp, userId: string): Promise<string> {
  const session = await t.uploadSessionRepo.save(
    t.uploadSessionRepo.create({
      userId,
      status: 'pending',
      chunkSizeBytes: 8 * 1024 * 1024,
      totalParts: 2,
      expectedSizeBytes: 12 * 1024 * 1024,
      checksumSha256: null,
      originalName: 'big.png',
      title: null,
      description: null,
      takenAt: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      completedFileId: null,
      completedAssetId: null,
    }),
  );
  const key = `upload-sessions/${userId}/${session.id}/part-0`;
  await mkdir(dirname(t.storage.pathFor(key)), { recursive: true });
  await writeFile(t.storage.pathFor(key), Buffer.from('chunk-bytes'));
  await t.uploadPartRepo.save(
    t.uploadPartRepo.create({ sessionId: session.id, partIndex: 0, sizeBytes: 11 }),
  );
  return key;
}

/** Plays the worker's `user-delete` consumer, exactly as admin-user-delete.spec.ts does. */
async function runQueuedDelete(t: ApiTestApp, userId: string): Promise<void> {
  const job = await t.getQueue('user-delete').getJob(`user-delete-${userId}`);
  expect(job).not.toBeNull();
  const data = job!.data as { backupPrefix: string; sig: string };
  const res = await request(apiServer(t))
    .post(`/worker/users/${userId}/purge`)
    .set(
      t.authHeader(
        t.signWorkerToken({ id: userId, email: 'worker@internal', role: 'user' }, { act: true }),
      ),
    )
    .set('X-Job-Signature', data.sig)
    .send({ backupPrefix: data.backupPrefix });
  expect(res.status).toBe(200);
  await job!.remove();
}

async function waitForDeleteState(
  t: ApiTestApp,
  admin: Record<string, string>,
  userId: string,
): Promise<string> {
  let state = '';
  for (let i = 0; i < 80; i++) {
    const status = await request(apiServer(t))
      .get(`/api/v1/admin/users/${userId}/delete-status`)
      .set(admin);
    expect(status.status).toBe(200);
    state = (status.body as { state: string }).state;
    if (state === 'completed' || state === 'failed') return state;
    await sleep(250);
  }
  return state;
}

describe('audit fixes (fails first)', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
  });

  it('1. cleanup-orphans leaves in-flight resumable chunks alone', async () => {
    const authHeader = await adminAuth(t);
    const user = await seedUser(t);
    const chunkKey = await seedInFlightSession(t, user.id);

    const res = await request(apiServer(t))
      .post('/api/v1/admin/cleanup-orphans/run')
      .set(authHeader);
    expect(res.status).toBe(200);

    // deletion of an in-flight chunk breaks the next complete() with ENOENT
    expect(await t.storage.exists(chunkKey)).toBe(true);
  });

  it('2. user wipe removes upload sessions and their chunk bytes', async () => {
    const authHeader = await adminAuth(t);
    const user = await seedUser(t);
    await seedInFlightSession(t, user.id);

    const del = await request(apiServer(t))
      .delete(`/api/v1/admin/users/${user.id}`)
      .set(authHeader);
    expect(del.status).toBe(202);
    await runQueuedDelete(t, user.id);
    expect(await waitForDeleteState(t, authHeader, user.id)).toBe('completed');

    expect(await t.uploadSessionRepo.count({ where: { userId: user.id } })).toBe(0);
    expect(await t.uploadPartRepo.count()).toBe(0);
    // restore re-creates the same userId, so leftovers would occupy the active-session cap
    expect(existsSync(join(t.storageDir, 'upload-sessions', user.id))).toBe(false);
  }, 120_000);

  it('3. an enqueue that never settles fails the upload instead of hanging it', async () => {
    const user = await seedUser(t);
    const bullMq = t.app.get(BullMqService);
    // a dead Redis with maxRetriesPerRequest: null queues the ADD instead of rejecting
    const spy = vi
      .spyOn(bullMq, 'getQueue')
      .mockReturnValue({ add: vi.fn(() => new Promise<never>(() => undefined)) } as never);
    const req = request(apiServer(t))
      .post('/api/v1/files')
      .set(auth(t, user))
      .attach('file', await pngBytes(), 'photo.png')
      .field('kind', 'photo');
    try {
      const status = await Promise.race([req.then((r) => r.status), sleep(2000).then(() => -1)]);
      // -1 means the request never answered: a client hangs until the proxy gives up
      expect(status).toBe(503);
    } finally {
      req.abort();
      spy.mockRestore();
    }
  }, 20_000);

  it('4. a sliding-renewed cookie cannot outlive the 7-day session cap', async () => {
    const user = await seedUser(t);
    // bare service: the app's JwtModule carries expiresIn, which conflicts with a pinned exp
    const jwt = new JwtService({ secret: TEST_AUTH_SECRET });
    const now = Math.floor(Date.now() / 1000);
    // session started 8 days ago, token still valid (1 min left, past half-TTL)
    const token = jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      sst: now - 8 * 24 * 3600,
      iat: now - 1799,
      exp: now + 60,
    });

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .set('Cookie', `${ACCESS_COOKIE}=${token}`);

    expect(res.status).toBe(401);
    // a cleared cookie (empty value) is fine; a re-minted token is not
    const setCookie = (res.headers['set-cookie'] ?? []) as unknown as string[];
    for (const line of setCookie) {
      if (line.startsWith(`${ACCESS_COOKIE}=`)) {
        expect(line.split(';')[0]).toBe(`${ACCESS_COOKIE}=`);
      }
    }
  });

  it('5. orphan cleanup keeps a thumbnail whose file is newer than the grace window', async () => {
    const authHeader = await adminAuth(t);
    const user = await seedUser(t);
    const now = Date.now();
    // explicit timestamps (raw SQL — Repository.update drops CreateDateColumn values): the
    // container clock can drift from Node's, so nothing here may lean on now() defaults
    const setCreatedAt = (table: string, id: string, at: number) =>
      t.dataSource.query(`UPDATE ${table} SET "createdAt" = $1 WHERE id = $2`, [new Date(at), id]);

    // a stale file makes the buggy NOT IN (:...staleFileIds) list non-empty
    const decoy = await seedFile(t, user.id);
    await setCreatedAt('files', decoy.id, now - 3 * 3600_000);

    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id, { kind: 'photo' });
    // regenerated thumbnail: the row is old, its file was registered just now
    const thumb = await seedThumbnail(t, asset.id);
    await setCreatedAt('files', thumb.fileId, now);
    await setCreatedAt('asset_thumbnails', thumb.id, now - 3600_000);

    const counts = await request(apiServer(t)).get('/api/v1/admin/orphan-counts').set(authHeader);
    expect(counts.body).toEqual({ orphanFiles: 1, orphanThumbnails: 0 });

    const res = await request(apiServer(t))
      .post('/api/v1/admin/cleanup-orphans/run')
      .set(authHeader);
    expect(res.status).toBe(200);

    expect(await t.thumbRepo.findOne({ where: { id: thumb.id } })).not.toBeNull();
    expect(await t.fileRepo.findOne({ where: { id: thumb.fileId } })).not.toBeNull();
  });
});
