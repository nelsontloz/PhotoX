import request from 'supertest';
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  jobSig,
  resetDb,
  seedAsset,
  seedFile,
  seedThumbnail,
  seedUser,
} from './helpers';
import type { ApiTestApp } from './helpers';
import type { Asset } from '@photox/shared-types';

describe('thumbnail status arbitration (worker metadata PATCH)', () => {
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

  function workerAuth(userId: string, assetId: string) {
    return {
      ...t.authHeader(
        t.signWorkerToken({ id: userId, email: 'worker@internal', role: 'user' }, { act: true }),
      ),
      'X-Job-Signature': jobSig(userId, assetId),
    };
  }

  function patchStatus(userId: string, assetId: string, thumbnailStatus: string) {
    return request(apiServer(t))
      .patch(`/worker/assets/${assetId}/metadata`)
      .set(workerAuth(userId, assetId))
      .send({ thumbnailStatus });
  }

  async function seedPendingAsset(): Promise<{ userId: string; assetId: string }> {
    const user = await seedUser(t);
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id);
    await t.assetRepo.update(asset.id, { thumbnailStatus: 'pending' });
    return { userId: user.id, assetId: asset.id };
  }

  it('ignores ready while a size is missing', async () => {
    const { userId, assetId } = await seedPendingAsset();
    for (const size of ['sm', 'md', 'lg']) await seedThumbnail(t, assetId, { size });

    const res = await patchStatus(userId, assetId, 'ready');

    expect(res.status).toBe(200);
    expect((res.body as Asset).thumbnailStatus).toBe('pending');
    expect((await t.assetRepo.findOneOrFail({ where: { id: assetId } })).thumbnailStatus).toBe(
      'pending',
    );
  });

  it('sets ready once all four sizes are committed', async () => {
    const { userId, assetId } = await seedPendingAsset();
    for (const size of ['sm', 'md', 'lg', 'xl']) await seedThumbnail(t, assetId, { size });

    const res = await patchStatus(userId, assetId, 'ready');

    expect(res.status).toBe(200);
    expect((res.body as Asset).thumbnailStatus).toBe('ready');
  });

  it('ignores a late failure once the set is complete', async () => {
    const { userId, assetId } = await seedPendingAsset();
    for (const size of ['sm', 'md', 'lg', 'xl']) await seedThumbnail(t, assetId, { size });
    expect((await patchStatus(userId, assetId, 'ready')).status).toBe(200);

    const res = await patchStatus(userId, assetId, 'failed');

    expect(res.status).toBe(200);
    expect((res.body as Asset).thumbnailStatus).toBe('ready');
  });

  it('sets failed while a size is missing', async () => {
    const { userId, assetId } = await seedPendingAsset();
    for (const size of ['sm', 'md']) await seedThumbnail(t, assetId, { size });

    const res = await patchStatus(userId, assetId, 'failed');

    expect(res.status).toBe(200);
    expect((res.body as Asset).thumbnailStatus).toBe('failed');
  });
});
