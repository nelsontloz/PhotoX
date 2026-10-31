import request from 'supertest';
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers';
import type { ApiTestApp } from './helpers';
import { seedSidecarAsset, sidecarHarness } from './helpers/sidecar';
import { adminAuthHarness, reprocessMatrix } from './helpers/reprocess-matrix';

const EMBEDDING_768 = Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0));
const EMBEDDING_768_B = Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) => (i === 1 ? 1 : 0));
const BODY = { kind: 'image', model: SEARCH_EMBEDDING_MODEL, embedding: EMBEDDING_768 };
const JOB_ID = (assetId: string) => `embed-reprocess-${assetId}-${SEARCH_EMBEDDING_MODEL}`;

describe('asset embeddings HTTP', () => {
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

  async function seedOwnedAsset() {
    return seedSidecarAsset(t);
  }

  it('requires a token', async () => {
    await sidecarHarness(t, {
      route: (id) => `/worker/assets/${id}/embedding`,
      body: BODY,
      repo: t.embeddingRepo,
    });
  });

  it('registers a 768-d image embedding for the asset owner', async () => {
    const { act, asset } = await seedOwnedAsset();
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/embedding`)
      .set(t.authHeader(act))
      .send(BODY);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });

    const rows = await t.embeddingRepo.find({ where: { assetId: asset.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('image');
    expect(rows[0]?.model).toBe(SEARCH_EMBEDDING_MODEL);
    expect(rows[0]?.embedding).toHaveLength(SEARCH_EMBEDDING_DIM);
    expect(rows[0]?.embedding[0]).toBeCloseTo(1);
    // backfill filter `embeddingStatus = 'ready'` must find registered assets
    expect((await t.assetRepo.findOneByOrFail({ id: asset.id })).embeddingStatus).toBe('ready');
  });

  it('upserts on (assetId, kind, model) instead of duplicating', async () => {
    const { act, asset } = await seedOwnedAsset();
    const post = (embedding: number[]) =>
      request(apiServer(t))
        .post(`/worker/assets/${asset.id}/embedding`)
        .set(t.authHeader(act))
        .send({ ...BODY, embedding });
    expect((await post(EMBEDDING_768)).status).toBe(201);
    expect((await post(EMBEDDING_768_B)).status).toBe(201);

    const rows = await t.embeddingRepo.find({ where: { assetId: asset.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.embedding[1]).toBeCloseTo(1);
  });

  it('persists embeddingStatus through PATCH metadata', async () => {
    const { act, asset } = await seedOwnedAsset();
    expect((await t.assetRepo.findOneByOrFail({ id: asset.id })).embeddingStatus).toBeNull();

    const res = await request(apiServer(t))
      .patch(`/worker/assets/${asset.id}/metadata`)
      .set(t.authHeader(act))
      .send({ embeddingStatus: 'failed' });
    expect(res.status).toBe(200);
    expect((await t.assetRepo.findOneByOrFail({ id: asset.id })).embeddingStatus).toBe('failed');
  });

  it.each([
    ['an unsupported kind', { ...BODY, kind: 'video_frame' }],
    ['an unknown model', { ...BODY, model: 'clip-vit-b32' }],
    ['a 512-d face embedding', { ...BODY, embedding: Array.from({ length: 512 }, () => 0.1) }],
    ['a non-finite entry', { ...BODY, embedding: [NaN, ...EMBEDDING_768.slice(1)] }],
    ['a scaled (non-unit) vector', { ...BODY, embedding: EMBEDDING_768.map((v) => v * 2) }],
  ])('422s %s without writing', async (_label, body) => {
    const { act, asset } = await seedOwnedAsset();
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/embedding`)
      .set(t.authHeader(act))
      .send(body);
    expect(res.status).toBe(422);
    expect(await t.embeddingRepo.count()).toBe(0);
  });

  it('404s registering on a cross-user asset without writing', async () => {
    const { asset } = await seedOwnedAsset();
    const other = await seedUser(t);
    const act = t.signToken({ id: other.id, email: other.email, role: other.role }, { act: true });
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/embedding`)
      .set(t.authHeader(act))
      .send(BODY);
    expect(res.status).toBe(404);
    expect(await t.embeddingRepo.count()).toBe(0);
  });

  it('accepts the worker delegated token as the asset owner', async () => {
    const { owner, asset } = await seedOwnedAsset();
    const act = t.signToken({ id: owner.id, email: owner.email, role: owner.role }, { act: true });
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/embedding`)
      .set(t.authHeader(act))
      .send(BODY);
    expect(res.status).toBe(201);
    expect(await t.embeddingRepo.count()).toBe(1);
  });

  describe('admin reprocess', () => {
    async function adminAuth(): Promise<Record<string, string>> {
      const admin = await seedUser(t, { role: 'admin' });
      return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }));
    }

    it('rejects unauthenticated and non-admin requests', async () => {
      await adminAuthHarness(t, {
        post: ['/api/v1/admin/embeddings/reprocess'],
        get: ['/api/v1/admin/embeddings/reprocess'],
      });
    });

    it('enqueues embed jobs for non-trashed photos, records the run and counts the queue', async () => {
      const auth = await adminAuth();
      const owner = await seedUser(t);
      const photo = async (isTrashed = false) => {
        const file = await seedFile(t, owner.id);
        const asset = await seedAsset(t, owner.id, file.id, { kind: 'photo', isTrashed });
        return { file, asset };
      };
      const a = await photo();
      const b = await photo();
      const trashed = await photo(true);
      const videoFile = await seedFile(t, owner.id, { mimeType: 'video/mp4' });
      await seedAsset(t, owner.id, videoFile.id, { kind: 'video' });

      await reprocessMatrix(t, auth, owner.id, [a, b], {
        route: '/api/v1/admin/embeddings/reprocess',
        queue: 'process-embeddings',
        jobIdFn: JOB_ID,
        jobName: 'embed',
        jobDataExtra: { reason: 'reprocess' },
        respKeys: { enqueued: 2, total: 2, model: SEARCH_EMBEDDING_MODEL },
        lastRunExtra: { model: SEARCH_EMBEDDING_MODEL },
        filter: [trashed.asset.id],
      });
    });
  });
});
