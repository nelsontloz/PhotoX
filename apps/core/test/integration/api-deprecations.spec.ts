import request from 'supertest';
import { apiServer, closeTestApp, createApiTestApp } from './helpers';
import type { ApiTestApp } from './helpers';

/**
 * Release 3 retired every operation the 2026-11 wave deprecated, and the deprecation framework is
 * gone with it. The retired operations must stay absent from the contract: a leftover handler
 * reappears in `/docs-json`, so the document — not the router — is the thing worth asserting
 * against.
 */
const RETIRED: Readonly<{ method: string; path: string }>[] = [
  { method: 'post', path: '/api/v1/assets/bulk-trash' },
  { method: 'get', path: '/api/v1/assets/{id}/content/download' },
  { method: 'patch', path: '/api/v1/faces/{id}/person' },
  { method: 'post', path: '/api/v1/admin/cleanup-orphans/run' },
  { method: 'post', path: '/api/v1/admin/thumbnails/reprocess' },
  { method: 'post', path: '/api/v1/admin/faces/reprocess' },
  { method: 'get', path: '/api/v1/admin/faces/reprocess' },
  { method: 'post', path: '/api/v1/admin/embeddings/reprocess' },
  { method: 'get', path: '/api/v1/admin/embeddings/reprocess' },
  { method: 'post', path: '/api/v1/admin/detections/reprocess' },
  { method: 'get', path: '/api/v1/admin/detections/reprocess' },
  { method: 'post', path: '/api/v1/admin/metadata/reprocess' },
  { method: 'get', path: '/api/v1/admin/metadata/reprocess' },
  { method: 'post', path: '/api/v1/admin/places/backfill' },
  { method: 'get', path: '/api/v1/admin/places/backfill' },
  { method: 'get', path: '/api/v1/admin/backups/status' },
  { method: 'get', path: '/api/v1/admin/backups/progress' },
  { method: 'delete', path: '/api/v1/admin/backups' },
  { method: 'post', path: '/api/v1/admin/restores' },
  { method: 'get', path: '/api/share/{token}/stream' },
  { method: 'get', path: '/api/share/{token}/assets/{assetId}/stream' },
];

describe('API deprecations', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({ swagger: true });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  interface Document {
    paths: Record<string, Record<string, unknown>>;
  }

  async function document(): Promise<Document> {
    return (await request(apiServer(t)).get('/docs-json')).body as Document;
  }

  it('no longer publishes any retired operation', async () => {
    const doc = await document();
    for (const { method, path } of RETIRED) {
      expect(doc.paths[path]?.[method], `${method.toUpperCase()} ${path} is back`).toBeUndefined();
    }
  });

  it('answers 404 on the wire for a retired alias', async () => {
    const server = apiServer(t);
    expect((await request(server).post('/api/v1/assets/bulk-trash')).status).toBe(404);
    expect((await request(server).get('/api/share/any-token/stream')).status).toBe(404);
  });
});
