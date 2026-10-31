import request from 'supertest';
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
import { FACE_EMBEDDING_DIM } from '@photox/shared-types';
import type { Asset } from '@photox/shared-types';

const EMBEDDING_512 = Array.from({ length: FACE_EMBEDDING_DIM }, () => 0.1);

describe('trash lifecycle', () => {
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

  async function seedOwner() {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const act = t.signToken({ id: user.id, email: user.email, role: user.role }, { act: true });
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id);
    return { user, token, act, asset };
  }

  it('rejects permanent delete of a non-trashed asset with 400 and leaves it intact', async () => {
    const { token, asset } = await seedOwner();

    const del = await request(apiServer(t))
      .delete(`/api/v1/assets/trashed/${asset.id}`)
      .set(t.authHeader(token));
    expect(del.status).toBe(400);

    const get = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token));
    expect(get.status).toBe(200);
    const body = get.body as unknown as Asset;
    expect(body.id).toBe(asset.id);
    expect(body.isTrashed).toBe(false);
    expect(body.trashedAt).toBeNull();
  });

  it('re-trashing is a no-op that preserves the original trashedAt', async () => {
    const { token, asset } = await seedOwner();

    const first = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(token));
    expect(first.status).toBe(204);

    const before = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token));
    expect(before.status).toBe(200);
    const trashedAt = (before.body as unknown as Asset).trashedAt;
    expect(trashedAt).toEqual(expect.any(String));

    const second = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(token));
    expect(second.status).toBe(204);

    const after = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token));
    expect(after.status).toBe(200);
    const body = after.body as unknown as Asset;
    expect(body.isTrashed).toBe(true);
    expect(body.trashedAt).toBe(trashedAt);
  });

  it('restore of a non-trashed asset is a 204 no-op', async () => {
    const { token, asset } = await seedOwner();

    const restore = await request(apiServer(t))
      .post(`/api/v1/assets/trashed/${asset.id}/restore`)
      .set(t.authHeader(token));
    expect(restore.status).toBe(204);

    const get = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token));
    expect(get.status).toBe(200);
    const body = get.body as unknown as Asset;
    expect(body.isTrashed).toBe(false);
    expect(body.trashedAt).toBeNull();
  });

  it('permanent delete cascades the faces of the asset', async () => {
    const { token, act, asset } = await seedOwner();

    const register = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/faces`)
      .set(t.authHeader(act))
      .send({
        faces: [{ box: { x: 1, y: 2, w: 10, h: 10 }, confidence: 0.9, embedding: EMBEDDING_512 }],
      });
    expect(register.status).toBe(201);
    expect((register.body as { count: number }).count).toBe(1);

    const before = await t.faceRepo.find();
    expect(before).toHaveLength(1);
    expect(before[0]?.assetId).toBe(asset.id);

    const trash = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(token));
    expect(trash.status).toBe(204);

    const del = await request(apiServer(t))
      .delete(`/api/v1/assets/trashed/${asset.id}`)
      .set(t.authHeader(token));
    expect(del.status).toBe(200);

    expect(await t.faceRepo.find()).toHaveLength(0);
  });

  it('keeps a trashed asset retrievable by id until it is permanently deleted', async () => {
    const { token, asset } = await seedOwner();

    const trash = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(token));
    expect(trash.status).toBe(204);

    const get = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token));
    expect(get.status).toBe(200);
    const body = get.body as unknown as Asset;
    expect(body.id).toBe(asset.id);
    expect(body.isTrashed).toBe(true);
    expect(body.trashedAt).toEqual(expect.any(String));
  });

  it('serves trashed list without :id shadowing and gets by uuid', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const activeFile = await seedFile(t, user.id);
    const active = await seedAsset(t, user.id, activeFile.id);
    const trashedFile = await seedFile(t, user.id);
    const trashed = await seedAsset(t, user.id, trashedFile.id, { isTrashed: true });
    const list = await request(apiServer(t)).get('/api/v1/assets/trashed').set(t.authHeader(token));
    expect(list.status).toBe(200);
    const body = list.body as unknown as { items: { id: string; isTrashed: boolean }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe(trashed.id);
    expect(body.items[0]?.isTrashed).toBe(true);
    const one = await request(apiServer(t))
      .get(`/api/v1/assets/${active.id}`)
      .set(t.authHeader(token));
    expect(one.status).toBe(200);
    const oneBody = one.body as unknown as { id: string };
    expect(oneBody.id).toBe(active.id);
  });
});
