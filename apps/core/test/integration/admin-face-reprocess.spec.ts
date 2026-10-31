import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
  apiServer,
} from './helpers';
import type { ApiTestApp } from './helpers';
import { adminAuthHarness, reprocessMatrix } from './helpers/reprocess-matrix';

describe('admin face reprocess and recluster', () => {
  let t: ApiTestApp;
  let auth: Record<string, string>;

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  // the admin fixture is hoisted out of the test bodies: its DB seeding belongs to the
  // hook budget, keeping the per-test window for the behavior under assertion
  beforeEach(async () => {
    await resetDb(t);
    auth = await adminAuth();
  }, 30_000);

  async function adminAuth(): Promise<Record<string, string>> {
    const admin = await seedUser(t, { role: 'admin' });
    return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }));
  }

  async function seedPhotoAsset(userId: string, opts?: { isTrashed?: boolean }) {
    const file = await seedFile(t, userId);
    const asset = await seedAsset(t, userId, file.id, {
      kind: 'photo',
      isTrashed: opts?.isTrashed ?? false,
    });
    return { file, asset };
  }

  it('rejects unauthenticated and non-admin requests', async () => {
    await adminAuthHarness(t, {
      post: ['/api/v1/admin/faces/reprocess', '/api/v1/admin/faces/recluster'],
      get: ['/api/v1/admin/faces/reprocess'],
    });
  });

  it('reports lastRun null and queue counts before any run', async () => {
    const res = await request(apiServer(t)).get('/api/v1/admin/faces/reprocess').set(auth);
    expect(res.status).toBe(200);
    const body = res.body as { lastRun: unknown; queue: Record<string, number> };
    expect(body.lastRun).toBeNull();
    expect(typeof body.queue).toBe('object');
  });

  it('enqueues re-embed jobs for non-trashed photos and records the run', async () => {
    const owner = await seedUser(t);
    const a = await seedPhotoAsset(owner.id);
    const b = await seedPhotoAsset(owner.id);
    const videoFile = await seedFile(t, owner.id, { mimeType: 'video/mp4' });
    await seedAsset(t, owner.id, videoFile.id, { kind: 'video' });
    const trashed = await seedPhotoAsset(owner.id, { isTrashed: true });

    await reprocessMatrix(t, auth, owner.id, [a, b], {
      route: '/api/v1/admin/faces/reprocess',
      queue: 'process-faces',
      jobIdFn: (id) => `face-reembed-${id}`,
      jobName: 're-embed',
      jobDataExtra: { reason: 're-embed' },
      respKeys: { enqueued: 2, total: 2 },
      filter: [trashed.asset.id],
    });
  });

  it('re-enqueues the same asset after a completed job is removed', async () => {
    const owner = await seedUser(t);
    const { asset } = await seedPhotoAsset(owner.id);
    const jobId = `face-reembed-${asset.id}`;

    const first = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess').set(auth);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ enqueued: 1, total: 1 });

    const queue = t.getQueue('process-faces');
    const job = await queue.getJob(jobId);
    expect(job?.opts.removeOnComplete).toBe(true);
    await job?.remove();
    expect(await queue.getJob(jobId)).toBeFalsy();

    const second = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess').set(auth);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ enqueued: 1, total: 1 });
    expect(await queue.getJob(jobId)).toBeTruthy();
  });

  it('enqueues one manual cluster job per distinct user with faces', async () => {
    const u1 = await seedUser(t);
    const u2 = await seedUser(t);
    const faceRow = (userId: string) =>
      t.faceRepo.create({
        assetId: randomUUID(),
        userId,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: null,
      });
    await t.faceRepo.save([faceRow(u1.id), faceRow(u1.id), faceRow(u2.id)]);

    const res = await request(apiServer(t)).post('/api/v1/admin/faces/recluster').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enqueued: 2 });

    const queue = t.getQueue('process-faces-cluster');
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
    const mine = jobs.filter((job) => {
      const data = job.data as { userId?: string; reason?: string };
      return data.reason === 'manual' && (data.userId === u1.id || data.userId === u2.id);
    });
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((job) => (job.data as { userId: string }).userId))).toEqual(
      new Set([u1.id, u2.id]),
    );
    expect(new Set(mine.map((job) => job.id)).size).toBe(2);
    for (const job of mine) {
      const userId = (job.data as { userId: string }).userId;
      expect(job.id).toMatch(new RegExp(`^cluster-${userId}-admin-\\d+$`));
    }
  });
});
