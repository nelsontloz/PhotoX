import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
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
import { TEST_WORKER_SECRET } from './test-setup';
import type { Asset, AssetListResponse } from '@photox/shared-types';

describe('thumbnails and trash JWT identity', () => {
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

  it('embeds thumbnails in getOne without userId and ignores query userId', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role });
    const file = await seedFile(t, a.id);
    const asset = await seedAsset(t, a.id, file.id);
    const thumbFileId = randomUUID();
    await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'sm',
        fileId: thumbFileId,
        width: 10,
        height: 10,
        bytes: 5,
      }),
    );
    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .query({ userId: b.id })
      .set(t.authHeader(tokenA));
    expect(res.status).toBe(200);
    const body = res.body as unknown as Asset;
    const thumb = body.thumbnails?.[0];
    expect(thumb).toMatchObject({
      size: 'sm',
      fileId: thumbFileId,
      width: 10,
      height: 10,
      bytes: 5,
    });
    expect(thumb?.createdAt).toEqual(expect.any(String));
  });

  it('embeds thumbnails in the asset list response', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id);
    const thumbFileId = randomUUID();
    await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'md',
        fileId: thumbFileId,
        width: 20,
        height: 20,
        bytes: 7,
      }),
    );
    const res = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(token));
    expect(res.status).toBe(200);
    const body = res.body as unknown as AssetListResponse;
    expect(body.items).toHaveLength(1);
    const thumb = body.items[0]?.thumbnails?.[0];
    expect(thumb).toMatchObject({
      size: 'md',
      fileId: thumbFileId,
      width: 20,
      height: 20,
      bytes: 7,
    });
    expect(thumb?.createdAt).toEqual(expect.any(String));
  });

  it('rejects cross-user thumbnail register and keeps owner writes working', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const file = await seedFile(t, a.id);
    const asset = await seedAsset(t, a.id, file.id);
    const thumbFile = await seedFile(t, a.id);
    const body = { size: 'sm', fileId: thumbFile.id, width: 10, height: 10, bytes: 5 };
    // worker-origin act token + the job binding core's guard recomputes (HMAC of sub:assetId)
    const workerAuth = (userId: string) => {
      const token = t.signWorkerToken(
        { id: userId, email: 'worker@internal', role: 'user' },
        { act: true },
      );
      const sig = createHmac('sha256', TEST_WORKER_SECRET)
        .update(`${userId}:${asset.id}`)
        .digest('hex');
      return { ...t.authHeader(token), 'X-Job-Signature': sig };
    };

    const crossRegister = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/thumbnails`)
      .set(workerAuth(b.id))
      .send(body);
    expect(crossRegister.status).toBe(404);
    expect(await t.thumbRepo.findOne({ where: { assetId: asset.id, size: 'sm' } })).toBeNull();

    const ownRegister = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/thumbnails`)
      .set(workerAuth(a.id))
      .send(body);
    expect(ownRegister.status).toBe(201);

    const crossOverwrite = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/thumbnails`)
      .set(workerAuth(b.id))
      .send({ ...body, fileId: randomUUID(), width: 99 });
    expect(crossOverwrite.status).toBe(404);
    const afterCross = await t.thumbRepo.findOneOrFail({
      where: { assetId: asset.id, size: 'sm' },
    });
    expect(afterCross.fileId).toBe(thumbFile.id);
    expect(afterCross.width).toBe(10);
  });

  it('rejects cross-user restore', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role });
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role });
    const file = await seedFile(t, a.id);
    const asset = await seedAsset(t, a.id, file.id, { isTrashed: true });
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/trashed/${asset.id}/restore`)
      .query({ userId: a.id })
      .set(t.authHeader(tokenB));
    expect(res.status).toBe(404);
    const own = await request(apiServer(t))
      .post(`/api/v1/assets/trashed/${asset.id}/restore`)
      .set(t.authHeader(tokenA));
    expect(own.status).toBe(204);
  });

  it('rejects cross-user permanent delete and keeps the asset', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role });
    const file = await seedFile(t, a.id);
    const asset = await seedAsset(t, a.id, file.id, { isTrashed: true });
    const res = await request(apiServer(t))
      .delete(`/api/v1/assets/trashed/${asset.id}`)
      .set(t.authHeader(tokenB));
    expect(res.status).toBe(404);
    expect(await t.assetRepo.findOne({ where: { id: asset.id } })).not.toBeNull();
  });

  it('empties only the caller trash', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role });
    const fileA = await seedFile(t, a.id);
    const assetA = await seedAsset(t, a.id, fileA.id, { isTrashed: true });
    const fileB = await seedFile(t, b.id);
    await seedAsset(t, b.id, fileB.id, { isTrashed: true });
    // emptyTrash filters by owner (200); the negative is that A's row survives
    const res = await request(apiServer(t))
      .delete('/api/v1/assets/trashed')
      .set(t.authHeader(tokenB));
    expect(res.status).toBe(200);
    expect(await t.assetRepo.findOne({ where: { id: assetA.id } })).not.toBeNull();
    expect(await t.assetRepo.count({ where: { userId: b.id, isTrashed: true } })).toBe(0);
  });

  it('permanently deletes a trashed asset', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id, { isTrashed: true });
    const thumbFileId = randomUUID();
    await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'sm',
        fileId: thumbFileId,
        width: 10,
        height: 10,
        bytes: 5,
      }),
    );

    const res = await request(apiServer(t))
      .delete(`/api/v1/assets/trashed/${asset.id}`)
      .set(t.authHeader(token));
    expect(res.status).toBe(200);
    expect(await t.assetRepo.findOne({ where: { id: asset.id } })).toBeNull();
    // thumbnail rows cascade with the asset
    expect(await t.thumbRepo.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it('empties trash', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    for (let i = 0; i < 2; i++) {
      const file = await seedFile(t, user.id);
      const asset = await seedAsset(t, user.id, file.id, { isTrashed: true });
      const thumbFileId = randomUUID();
      await t.thumbRepo.save(
        t.thumbRepo.create({
          assetId: asset.id,
          size: 'sm',
          fileId: thumbFileId,
          width: 10,
          height: 10,
          bytes: 5,
        }),
      );
    }

    const res = await request(apiServer(t))
      .delete('/api/v1/assets/trashed')
      .set(t.authHeader(token));
    expect(res.status).toBe(200);
    expect(await t.assetRepo.count({ where: { isTrashed: true } })).toBe(0);
    expect(await t.thumbRepo.count()).toBe(0);
  });
});
