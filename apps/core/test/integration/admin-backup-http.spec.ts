import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { manifestKey } from '@photox/shared-config';
import { S3BackupService } from '../../src/backup/s3-backup.service';
import { apiServer, closeTestApp, createApiTestApp, resetDb, seedFile, seedUser } from './helpers';
import type { ApiTestApp } from './helpers';
import type { User } from '../../src/database/entities/user.entity';
import { adminAuthHarness } from './helpers/reprocess-matrix';

const BACKUPS = '/api/v1/admin/backups';

/**
 * The harness has Postgres + Redis only. The in-memory store stands in for S3: backup starts
 * only read (no previous manifest), while the restore case seeds a manifest under the exact
 * backup prefix. A missing key is still the NoSuchKey the service treats as "no manifest".
 */
const s3State = { objects: new Map<string, Buffer>() };
const s3Backup = {
  ensureBucket: (): Promise<void> => Promise.resolve(),
  listKeys: (): Promise<string[]> => Promise.resolve([...s3State.objects.keys()]),
  getBuffer: (key: string): Promise<Buffer> => {
    const found = s3State.objects.get(key);
    if (!found) {
      const err = new Error('missing key');
      err.name = 'NoSuchKey';
      throw err;
    }
    return Promise.resolve(Buffer.from(found));
  },
  headObject: (key: string): Promise<void> => {
    if (!s3State.objects.has(key)) {
      const err = new Error('missing key');
      err.name = 'NoSuchKey';
      throw err;
    }
    return Promise.resolve();
  },
};

/** A restorable snapshot for `user`: the manifest schema with no rows to transfer. */
function emptyManifest(user: User): Buffer {
  return Buffer.from(
    JSON.stringify({
      manifestVersion: 1,
      userId: user.id,
      emailAtBackup: user.email,
      backedUpAt: '2026-10-01T00:00:00.000Z',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        passwordHash: 'test-hash',
        displayName: user.displayName,
        tokensValidAfter: null,
      },
      files: [],
      assets: [],
      albums: [],
      albumAssets: [],
      shares: [],
      persons: [],
    }),
  );
}

function authHeader(t: ApiTestApp, user: User): Record<string, string> {
  return t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));
}

describe('admin backup HTTP surface', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({ overrides: [{ token: S3BackupService, value: s3Backup }] });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    s3State.objects.clear();
    await resetDb(t);
  });

  it('rejects anonymous and non-admin callers on every backup route', async () => {
    const ghost = randomUUID();
    await adminAuthHarness(t, {
      post: [BACKUPS, '/api/v1/admin/restores', '/api/v1/admin/restores/merge'],
      get: [
        `${BACKUPS}/overview`,
        `${BACKUPS}/status?emailOrId=${ghost}`,
        `${BACKUPS}/progress?emailOrId=${ghost}`,
        `${BACKUPS}/runs/${ghost}`,
      ],
    });

    // adminAuthHarness only drives POST/GET — DELETE needs the same 401/403 pair inline.
    const anon = await request(apiServer(t)).delete(`${BACKUPS}?emailOrId=${ghost}`);
    expect(anon.status).toBe(401);
    const denied = await request(apiServer(t))
      .delete(`${BACKUPS}?emailOrId=${ghost}`)
      .set(authHeader(t, await seedUser(t)));
    expect(denied.status).toBe(403);
  });

  it('404s an unknown target on the read and delete routes', async () => {
    const auth = authHeader(t, await seedUser(t, { role: 'admin' }));
    const ghost = randomUUID();
    const server = apiServer(t);

    // A status read for a target with no manifest is a 200 {exists:false} by design
    // (backupStatus swallows locateBackup's 404); progress and delete resolve the
    // target first and 404 instead.
    const status = await request(server).get(`${BACKUPS}/status?emailOrId=${ghost}`).set(auth);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ exists: false });

    const progress = await request(server).get(`${BACKUPS}/progress?emailOrId=${ghost}`).set(auth);
    expect(progress.status).toBe(404);

    const deleted = await request(server).delete(`${BACKUPS}?emailOrId=${ghost}`).set(auth);
    expect(deleted.status).toBe(404);
  });

  it('400s a delete without emailOrId', async () => {
    const auth = authHeader(t, await seedUser(t, { role: 'admin' }));
    const res = await request(apiServer(t)).delete(BACKUPS).set(auth);
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('404s an unknown run id', async () => {
    const auth = authHeader(t, await seedUser(t, { role: 'admin' }));
    const res = await request(apiServer(t)).get(`${BACKUPS}/runs/${randomUUID()}`).set(auth);
    expect(res.status).toBe(404);
  });

  it('starts a backup over HTTP and reports the queued run', async () => {
    const auth = authHeader(t, await seedUser(t, { role: 'admin' }));
    const target = await seedUser(t);
    await seedFile(t, target.id);

    const started = await request(apiServer(t))
      .post(BACKUPS)
      .set(auth)
      .send({ emailOrId: target.id });
    expect(started.status).toBe(202);
    const runId = (started.body as { runId: string }).runId;
    // a 202 points at the pollable run and carries the centralized retry hint
    expect(started.headers.location).toBe(`${BACKUPS}/runs/${runId}`);
    expect(started.headers['retry-after']).toBe('5');

    const run = await request(apiServer(t)).get(`${BACKUPS}/runs/${runId}`).set(auth);
    expect(run.status).toBe(200);
    // The dispatcher and transfer consumers no-op under NODE_ENV=test, so the run keeps its
    // item queued instead of racing this read.
    expect(run.body).toMatchObject({
      id: runId,
      kind: 'backup',
      userId: target.id,
      state: 'running',
      total: 1,
      completed: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('starts a restore with the run Location and retry hint', async () => {
    const auth = authHeader(t, await seedUser(t, { role: 'admin' }));
    const target = await seedUser(t);
    s3State.objects.set(manifestKey(target.email, target.id), emptyManifest(target));
    // a restore target: the account row is gone, the snapshot is not
    await t.userRepo.delete({ id: target.id });

    const started = await request(apiServer(t))
      .post('/api/v1/admin/restores')
      .set(auth)
      .send({ emailOrId: target.id });

    expect(started.status).toBe(202);
    const runId = (started.body as { runId: string }).runId;
    // restores poll the same runs resource as backups
    expect(started.headers.location).toBe(`${BACKUPS}/runs/${runId}`);
    expect(started.headers['retry-after']).toBe('5');
    expect(await t.userRepo.findOne({ where: { id: target.id } })).not.toBeNull();
  });

  it('409s a second backup while one is active', async () => {
    const auth = authHeader(t, await seedUser(t, { role: 'admin' }));
    const target = await seedUser(t);

    const first = await request(apiServer(t))
      .post(BACKUPS)
      .set(auth)
      .send({ emailOrId: target.email });
    expect(first.status).toBe(202);

    const second = await request(apiServer(t))
      .post(BACKUPS)
      .set(auth)
      .send({ emailOrId: target.email });
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('CONFLICT');
  });
});
