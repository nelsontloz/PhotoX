import request from 'supertest';
import { apiServer, seedUser } from '../helpers';
import type { ApiTestApp } from '../helpers';

export interface ReprocessMatrixOpts {
  route: string;
  /** GET status route when it differs (`/reprocess-runs` vs `/reprocess-runs/:kind`). */
  statusRoute?: string;
  queue: string;
  jobIdFn: (assetId: string, size?: string) => string;
  jobName?: string;
  jobDataExtra?: Record<string, unknown>;
  respKeys: Record<string, unknown>;
  lastRunExtra?: Record<string, unknown>;
  fanout?: string[];
  filter?: string[];
  reqBody?: Record<string, unknown>;
  noStatus?: boolean;
}

export interface AdminAuthHarnessOpts {
  post: string[];
  get: string[];
}

export async function adminAuthHarness(t: ApiTestApp, opts: AdminAuthHarnessOpts): Promise<void> {
  const routes = { post: opts.post, get: opts.get };
  for (const method of ['post', 'get'] as const) {
    for (const route of routes[method]) {
      const anon = await request(apiServer(t))[method](route);
      expect(anon.status).toBe(401);
    }
  }
  const user = await seedUser(t);
  const auth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));
  for (const method of ['post', 'get'] as const) {
    for (const route of routes[method]) {
      const res = await request(apiServer(t))[method](route).set(auth);
      expect(res.status).toBe(403);
    }
  }
}

// ponytail: one matrix for queued reprocess (detect/embed/faces/metadata/thumbnails fanout).
export async function reprocessMatrix(
  t: ApiTestApp,
  auth: Record<string, string>,
  ownerId: string,
  included: { file: { id: string }; asset: { id: string } }[],
  opts: ReprocessMatrixOpts,
): Promise<void> {
  const server = apiServer(t);
  const statusRoute = opts.statusRoute ?? opts.route;
  if (!opts.noStatus) {
    const before = await request(server).get(statusRoute).set(auth);
    expect(before.status).toBe(200);
    expect((before.body as { lastRun: unknown }).lastRun).toBeNull();
  }

  const post = opts.reqBody
    ? await request(server).post(opts.route).set(auth).send(opts.reqBody)
    : await request(server).post(opts.route).set(auth);
  expect(post.status).toBe(202);
  expect(post.body).toEqual(opts.respKeys);

  const queue = t.getQueue(opts.queue);
  const sizes = opts.fanout ?? [undefined];
  for (const { file, asset } of included) {
    for (const size of sizes) {
      const job = await queue.getJob(opts.jobIdFn(asset.id, size));
      expect(job).toBeTruthy();
      expect(job?.opts.removeOnComplete).toBe(true);
      expect(job?.data as Record<string, unknown>).toMatchObject({
        assetId: asset.id,
        fileId: file.id,
        userId: ownerId,
        ...(size === undefined ? {} : { size }),
        ...opts.jobDataExtra,
      });
      if (opts.jobName) expect(job?.name).toBe(opts.jobName);
    }
  }
  for (const excludedId of opts.filter ?? []) {
    for (const size of sizes) {
      expect(await queue.getJob(opts.jobIdFn(excludedId, size))).toBeFalsy();
    }
  }

  if (!opts.noStatus) {
    const status = await request(server).get(statusRoute).set(auth);
    expect(status.status).toBe(200);
    const body = status.body as {
      lastRun: Record<string, unknown> & { startedAt: string };
      queue: Record<string, number>;
    };
    expect(body.lastRun).toBeTruthy();
    if (opts.lastRunExtra) expect(body.lastRun).toMatchObject(opts.lastRunExtra);
    expect(Number.isNaN(Date.parse(body.lastRun.startedAt))).toBe(false);
    if ('total' in opts.respKeys) expect(body.lastRun.total).toBe(opts.respKeys.total);
    if ('enqueued' in opts.respKeys) expect(body.lastRun.enqueued).toBe(opts.respKeys.enqueued);
    const expectedJobs = included.length * (opts.fanout?.length ?? 1);
    expect(body.queue.waiting).toBeGreaterThanOrEqual(expectedJobs);
  }
}
