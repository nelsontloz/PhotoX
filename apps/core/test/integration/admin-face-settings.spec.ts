import request from 'supertest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FaceDetectionSettings } from '@photox/shared-types';
import { closeTestApp, createApiTestApp, resetDb, seedUser, apiServer } from './helpers';
import type { ApiTestApp } from './helpers';

describe('admin face detection settings', () => {
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

  async function adminAuth(): Promise<Record<string, string>> {
    const admin = await seedUser(t, { role: 'admin' });
    return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }));
  }

  it('rejects unauthenticated requests', async () => {
    const get = await request(apiServer(t)).get('/api/v1/admin/face-detection');
    expect(get.status).toBe(401);
  });

  it('rejects non-admin requests', async () => {
    const user = await seedUser(t);
    const auth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));
    const get = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth);
    expect(get.status).toBe(403);
  });

  it('returns only the scrfd model availability for admin', async () => {
    const auth = await adminAuth();
    const res = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ modelAvailable: false } satisfies FaceDetectionSettings);
  });

  it('reports scrfd model availability from STORAGE_DIR/models', async () => {
    const auth = await adminAuth();
    await mkdir(join(t.storageDir, 'models'), { recursive: true });
    await writeFile(join(t.storageDir, 'models', 'det_10g.onnx'), Buffer.from('model'));
    const res = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ modelAvailable: true } satisfies FaceDetectionSettings);
  });
});
