import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { S3BackupService } from '../../src/backup/s3-backup.service';
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  jobSig,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers';
import type { ApiTestApp } from './helpers';
import type { User } from '../../src/database/entities/user.entity';

/**
 * Release 1 of the API contract polish, exercised over HTTP:
 * - exact Location headers on the listed 201/202 routes;
 * - Retry-After: 5 on every 202 only;
 * - add-assets reports rows actually inserted;
 * - strict query booleans (400 for anything but true/false spellings);
 * - Page envelope on the admin backup overview;
 * - docs operationIds/tags/description/media types;
 * - problem+json negotiation.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface DocOperation {
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
  description?: string;
  responses?: Record<
    string,
    { content?: Record<string, { schema?: unknown }>; description?: string }
  >;
}

interface ApiDoc {
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<
      string,
      { type?: string; properties?: Record<string, { type?: string; description?: string }> }
    >;
  };
}

interface OperationEntry {
  path: string;
  method: string;
  op: DocOperation;
}

function operations(doc: ApiDoc): OperationEntry[] {
  const entries: OperationEntry[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method] as DocOperation | undefined;
      if (op && typeof op === 'object' && !Array.isArray(op)) entries.push({ path, method, op });
    }
  }
  return entries;
}

function authFor(t: ApiTestApp, user: User): Record<string, string> {
  return t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }));
}

function pngish(size: number): Buffer {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([magic, Buffer.alloc(size - magic.length, 0x41)]);
}

function expectErrorEnvelope(body: unknown, status: number): void {
  expect(body).toMatchObject({ statusCode: status });
  expect(typeof (body as { code?: unknown }).code).toBe('string');
  expect(typeof (body as { message?: unknown }).message).toBe('string');
  expect(typeof (body as { requestId?: unknown }).requestId).toBe('string');
}

// The harness has Postgres + Redis only; the overview must not need Floci for its paging tests.
const emptyBackupStore = {
  ensureBucket: (): Promise<void> => Promise.resolve(),
  listKeys: (): Promise<string[]> => Promise.resolve([]),
  getBuffer: (key: string): Promise<Buffer> => {
    const err = new Error(`missing key ${key}`);
    err.name = 'NoSuchKey';
    throw err;
  },
  headObject: (key: string): Promise<void> => {
    const err = new Error(`missing key ${key}`);
    err.name = 'NoSuchKey';
    throw err;
  },
};

describe('API contract release 1', () => {
  let t: ApiTestApp;
  let doc: ApiDoc;

  beforeAll(async () => {
    t = await createApiTestApp({
      swagger: true,
      overrides: [{ token: S3BackupService, value: emptyBackupStore }],
    });
    const res = await request(apiServer(t)).get('/docs-json');
    expect(res.status).toBe(200);
    doc = res.body as ApiDoc;
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
  });

  describe('Location headers', () => {
    it('points every listed 201 at the created resource', async () => {
      const user = await seedUser(t);
      const auth = authFor(t, user);
      const server = apiServer(t);

      const album = await request(server).post('/api/v1/albums').set(auth).send({ name: 'Trip' });
      expect(album.status).toBe(201);
      expect(album.headers.location).toBe(`/api/v1/albums/${(album.body as { id: string }).id}`);

      const file = await seedFile(t, user.id);
      const asset = await seedAsset(t, user.id, file.id);
      const share = await request(server)
        .post('/api/v1/shares')
        .set(auth)
        .send({ assetId: asset.id });
      expect(share.status).toBe(201);
      const token = (share.body as { token: string }).token;
      expect(share.headers.location).toBe(`/api/share/${token}`);

      const bytes = pngish(64);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      const session = await request(server)
        .post('/api/v1/uploads')
        .set(auth)
        .send({ originalName: 'small.png', sizeBytes: bytes.length, checksumSha256: checksum });
      expect(session.status).toBe(201);
      const uploadId = (session.body as { uploadId: string }).uploadId;
      expect(session.headers.location).toBe(`/api/v1/uploads/${uploadId}`);

      const part = await request(server)
        .put(`/api/v1/uploads/${uploadId}/parts/0`)
        .set(auth)
        .set('Content-Type', 'application/octet-stream')
        .set('X-Part-Sha256', checksum)
        .send(bytes);
      expect(part.status).toBe(204);

      const complete = await request(server).post(`/api/v1/uploads/${uploadId}/complete`).set(auth);
      expect(complete.status).toBe(201);
      const assetId = (complete.body as { asset: { id: string } }).asset.id;
      expect(complete.headers.location).toBe(`/api/v1/assets/${assetId}`);

      // a replay stored no new bytes (200) but still announces the asset
      const replay = await request(server).post(`/api/v1/uploads/${uploadId}/complete`).set(auth);
      expect(replay.status).toBe(200);
      expect(replay.headers.location).toBe(`/api/v1/assets/${assetId}`);

      const admin = await seedUser(t, { role: 'admin' });
      const created = await request(server)
        .post('/api/v1/admin/users')
        .set(authFor(t, admin))
        .send({
          displayName: 'New User',
          email: `${randomUUID()}@example.com`,
          password: 'password123',
        });
      expect(created.status).toBe(201);
      expect(created.headers.location).toBe(
        `/api/v1/admin/users/${(created.body as { id: string }).id}`,
      );
    });

    it('never leaks a Location onto a plain read or update', async () => {
      const user = await seedUser(t);
      const auth = authFor(t, user);
      const server = apiServer(t);

      const created = await request(server).post('/api/v1/albums').set(auth).send({ name: 'Trip' });
      const albumId = (created.body as { id: string }).id;

      const read = await request(server).get(`/api/v1/albums/${albumId}`).set(auth);
      expect(read.status).toBe(200);
      expect(read.headers.location).toBeUndefined();

      const patched = await request(server)
        .patch(`/api/v1/albums/${albumId}`)
        .set(auth)
        .send({ name: 'Renamed' });
      expect(patched.status).toBe(200);
      expect(patched.headers.location).toBeUndefined();
    });
  });

  describe('Retry-After on 202 responses only', () => {
    it('adds Retry-After: 5 to persons/cluster and asset reprocess', async () => {
      const user = await seedUser(t);
      const auth = authFor(t, user);
      const server = apiServer(t);

      const cluster = await request(server).post('/api/v1/persons/cluster').set(auth);
      expect(cluster.status).toBe(202);
      expect(cluster.headers['retry-after']).toBe('5');
      // only the listed routes announce a resource
      expect(cluster.headers.location).toBeUndefined();

      const file = await seedFile(t, user.id);
      const asset = await seedAsset(t, user.id, file.id);
      const thumbs = await request(server)
        .post(`/api/v1/assets/${asset.id}/reprocess-thumbnails`)
        .set(auth);
      expect(thumbs.status).toBe(202);
      expect(thumbs.headers['retry-after']).toBe('5');
      expect(thumbs.headers.location).toBeUndefined();

      const videoAsset = await seedAsset(t, user.id, (await seedFile(t, user.id)).id, {
        kind: 'video',
      });
      const video = await request(server)
        .post(`/api/v1/assets/${videoAsset.id}/reprocess-video`)
        .set(auth);
      expect(video.status).toBe(202);
      expect(video.headers['retry-after']).toBe('5');
    });

    it('adds Retry-After: 5 to the admin user delete 202 with its status Location', async () => {
      const admin = await seedUser(t, { role: 'admin' });
      const target = await seedUser(t);
      const server = apiServer(t);

      const deleted = await request(server)
        .delete(`/api/v1/admin/users/${target.id}`)
        .set(authFor(t, admin));
      expect(deleted.status).toBe(202);
      expect(deleted.headers['retry-after']).toBe('5');
      expect(deleted.headers.location).toBe(`/api/v1/admin/users/${target.id}/delete-status`);
    });

    it('leaves 200/201 responses without Retry-After', async () => {
      const user = await seedUser(t);
      const auth = authFor(t, user);
      const server = apiServer(t);

      const list = await request(server).get('/api/v1/assets').set(auth);
      expect(list.status).toBe(200);
      expect(list.headers['retry-after']).toBeUndefined();

      const album = await request(server).post('/api/v1/albums').set(auth).send({ name: 'Trip' });
      expect(album.status).toBe(201);
      expect(album.headers['retry-after']).toBeUndefined();
    });
  });

  describe('album add-assets count', () => {
    it('reports two rows for two new assets plus one already in the album', async () => {
      const user = await seedUser(t);
      const auth = authFor(t, user);
      const server = apiServer(t);

      const existing = await seedAsset(t, user.id, (await seedFile(t, user.id)).id);
      const freshA = await seedAsset(t, user.id, (await seedFile(t, user.id)).id);
      const freshB = await seedAsset(t, user.id, (await seedFile(t, user.id)).id);

      const created = await request(server).post('/api/v1/albums').set(auth).send({ name: 'Trip' });
      const albumId = (created.body as { id: string }).id;

      const first = await request(server)
        .post(`/api/v1/albums/${albumId}/assets`)
        .set(auth)
        .send({ assetIds: [existing.id] });
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ added: 1 });

      const batch = await request(server)
        .post(`/api/v1/albums/${albumId}/assets`)
        .set(auth)
        .send({ assetIds: [existing.id, freshA.id, freshB.id] });
      expect(batch.status).toBe(201);
      expect(batch.body).toEqual({ added: 2 });

      const readd = await request(server)
        .post(`/api/v1/albums/${albumId}/assets`)
        .set(auth)
        .send({ assetIds: [existing.id, freshA.id, freshB.id] });
      expect(readd.status).toBe(201);
      expect(readd.body).toEqual({ added: 0 });
      expect(await t.albumAssetRepo.count({ where: { albumId } })).toBe(3);
    });
  });

  describe('strict query booleans', () => {
    it('accepts the documented spellings and the boolean default', async () => {
      const user = await seedUser(t);
      const auth = authFor(t, user);
      const server = apiServer(t);

      for (const query of [
        '',
        '?isTrashed=false',
        '?favorite=true',
        '?favorite=false',
        '?hasLocations=true',
      ]) {
        const res = await request(server).get(`/api/v1/assets${query}`).set(auth);
        expect(res.status, query).toBe(200);
      }
    });

    it.each(['?isTrashed=1', '?favorite=TRUE', '?hasLocations=yes', '?isTrashed='])(
      'rejects %s on the assets list with 400',
      async (query) => {
        const user = await seedUser(t);
        const res = await request(apiServer(t)).get(`/api/v1/assets${query}`).set(authFor(t, user));

        expect(res.status).toBe(400);
        expectErrorEnvelope(res.body, 400);
      },
    );

    it('rejects a repeated parameter (array) instead of picking one', async () => {
      const user = await seedUser(t);
      const res = await request(apiServer(t))
        .get('/api/v1/assets?isTrashed=true&isTrashed=false')
        .set(authFor(t, user));

      expect(res.status).toBe(400);
      expectErrorEnvelope(res.body, 400);
    });

    it('rejects a non-boolean favorite on the timeline index', async () => {
      const user = await seedUser(t);
      const res = await request(apiServer(t))
        .get('/api/v1/timeline/index?favorite=1')
        .set(authFor(t, user));

      expect(res.status).toBe(400);
      expectErrorEnvelope(res.body, 400);
    });

    it('keeps purge-trash behind an explicit boolean', async () => {
      const user = await seedUser(t);
      const auth = authFor(t, user);
      const server = apiServer(t);

      const invalid = await request(server).delete('/api/v1/assets?isTrashed=1').set(auth);
      expect(invalid.status).toBe(400);
      expectErrorEnvelope(invalid.body, 400);

      const valid = await request(server).delete('/api/v1/assets?isTrashed=true').set(auth);
      expect(valid.status).toBe(204);
    });

    it('applies to the worker face list (includeEmbeddings/excludeTrashed)', async () => {
      const user = await seedUser(t);
      const token = t.signToken({ id: user.id, email: user.email, role: user.role }, { act: true });
      const server = apiServer(t);

      const works = await request(server)
        .get('/worker/faces?includeEmbeddings=true&excludeTrashed=false')
        .set(t.authHeader(token))
        .set('X-Job-Signature', jobSig(user.id, user.id));
      expect(works.status).toBe(200);

      for (const query of ['?includeEmbeddings=1', '?excludeTrashed=TRUE']) {
        const res = await request(server)
          .get(`/worker/faces${query}`)
          .set(t.authHeader(token))
          .set('X-Job-Signature', jobSig(user.id, user.id));
        expect(res.status, query).toBe(400);
        expectErrorEnvelope(res.body, 400);
      }
    });
  });

  describe('backup overview page', () => {
    it('returns Page<BackupOverviewRow> with total before the slice', async () => {
      const admin = await seedUser(t, { role: 'admin' });
      await seedUser(t);
      const auth = authFor(t, admin);
      const server = apiServer(t);

      const all = await request(server).get('/api/v1/admin/backups/overview').set(auth);
      expect(all.status).toBe(200);
      const page = all.body as { items: unknown[]; total: number };
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(2);
      expect(page).not.toHaveProperty('limit');
      expect(page).not.toHaveProperty('offset');

      const firstPage = await request(server)
        .get('/api/v1/admin/backups/overview?limit=1&offset=0')
        .set(auth);
      expect(firstPage.status).toBe(200);
      expect((firstPage.body as { items: unknown[] }).items).toHaveLength(1);
      expect((firstPage.body as { total: number }).total).toBe(2);

      const secondPage = await request(server)
        .get('/api/v1/admin/backups/overview?limit=1&offset=1')
        .set(auth);
      expect(secondPage.status).toBe(200);
      expect((secondPage.body as { items: unknown[] }).items).toHaveLength(1);
      expect((secondPage.body as { total: number }).total).toBe(2);
    });

    it.each(['limit=0', 'limit=1001', 'limit=1.5', 'offset=-1'])(
      'rejects %s with 400',
      async (query) => {
        const admin = await seedUser(t, { role: 'admin' });
        const res = await request(apiServer(t))
          .get(`/api/v1/admin/backups/overview?${query}`)
          .set(authFor(t, admin));

        expect(res.status).toBe(400);
        expectErrorEnvelope(res.body, 400);
      },
    );
  });

  describe('OpenAPI operationIds and tags', () => {
    it('emits unique camelCase operationIds with no Controller suffix', () => {
      const ids = operations(doc).flatMap(({ op }) => (op.operationId ? [op.operationId] : []));
      expect(ids.length).toBeGreaterThan(50);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).not.toMatch(/Controller/);
        expect(id).toMatch(/^[a-z][A-Za-z0-9]*$/);
      }
    });

    it('starts each operationId with the handler method key', () => {
      expect((doc.paths['/api/v1/assets']?.get as DocOperation).operationId).toBe('listAssets');
      expect((doc.paths['/api/v1/admin/users']?.post as DocOperation).operationId).toMatch(
        /^create/,
      );
      expect((doc.paths['/api/v1/shares']?.post as DocOperation).operationId).toMatch(/^create/);
      expect((doc.paths['/api/v1/auth/login']?.post as DocOperation).operationId).toMatch(/^login/);
    });

    it('retags duplicates, similar and detections as assets', () => {
      expect((doc.paths['/api/v1/assets/{id}/duplicates']?.get as DocOperation).tags).toEqual([
        'assets',
      ]);
      expect((doc.paths['/api/v1/assets/{id}/similar']?.get as DocOperation).tags).toEqual([
        'assets',
      ]);
      expect((doc.paths['/api/v1/assets/{id}/detections']?.get as DocOperation).tags).toEqual([
        'assets',
      ]);
    });

    it('retags the faces surface as faces and keeps the other tags', () => {
      expect((doc.paths['/api/v1/faces/{id}/thumb']?.get as DocOperation).tags).toEqual(['faces']);
      expect((doc.paths['/api/v1/faces/{id}/person']?.patch as DocOperation).tags).toEqual([
        'faces',
      ]);
      expect((doc.paths['/api/v1/faces/{id}/person']?.put as DocOperation).tags).toEqual(['faces']);

      const unchanged: [string, string, string][] = [
        ['/api/v1/persons', 'get', 'persons'],
        ['/api/v1/albums', 'get', 'albums'],
        ['/api/v1/search', 'get', 'search'],
        ['/api/v1/uploads', 'post', 'uploads'],
        ['/api/v1/shares', 'get', 'shares'],
        ['/api/share/{token}', 'get', 'shares'],
        ['/worker/faces', 'get', 'worker'],
        ['/api/v1/timeline/index', 'get', 'timeline'],
        ['/api/v1/admin/users', 'get', 'admin'],
        ['/api/v1/auth/login', 'post', 'auth'],
        ['/api/v1/files', 'post', 'files'],
      ];
      for (const [path, method, tag] of unchanged) {
        const item = doc.paths[path] as Record<string, DocOperation> | undefined;
        expect(item?.[method]?.tags, `${method} ${path}`).toEqual([tag]);
      }
    });

    it('marks PATCH /faces/{id}/person deprecated but keeps it', () => {
      const item = doc.paths['/api/v1/faces/{id}/person'] as
        Record<string, DocOperation> | undefined;
      expect(item?.patch).toBeDefined();
      expect(item?.patch?.deprecated).toBe(true);
      expect(item?.put).toBeDefined();
      expect(item?.put?.deprecated).toBeFalsy();
    });

    it('states that the share Location is the public link', () => {
      const op = doc.paths['/api/v1/shares']?.post as DocOperation | undefined;
      expect(op?.description).toMatch(/Location/);
      expect(op?.description).toMatch(/public/i);
    });

    it('keeps AddAssetsResponseModel on the add-assets 201', () => {
      const item = doc.paths['/api/v1/albums/{id}/assets'] as
        Record<string, DocOperation> | undefined;
      const schema = item?.post?.responses?.['201']?.content?.['application/json']?.schema;
      expect(JSON.stringify(schema)).toContain('AddAssetsResponseModel');
    });
  });

  describe('OpenAPI error media types', () => {
    it('declares application/json and application/problem+json with the same ApiError schema', () => {
      for (const { path, method, op } of operations(doc)) {
        for (const [status, response] of Object.entries(op.responses ?? {})) {
          if (Number(status) < 400) continue;
          const json = response.content?.['application/json']?.schema;
          const problem = response.content?.['application/problem+json']?.schema;
          expect(json, `${method} ${path} ${status}`).toEqual({
            $ref: '#/components/schemas/ApiError',
          });
          expect(problem, `${method} ${path} ${status}`).toEqual({
            $ref: '#/components/schemas/ApiError',
          });
        }
      }
    });

    it('documents the status/detail aliases on the ApiError component', () => {
      const schema = doc.components?.schemas?.ApiError;
      expect(schema?.properties?.status?.type).toBe('integer');
      expect(schema?.properties?.detail?.type).toBe('string');
    });
  });

  describe('API description', () => {
    const description = () => doc.info.description ?? '';

    function paginationRow(pattern: RegExp, exclude?: RegExp): string {
      const line = description()
        .split('\n')
        .find((entry) => pattern.test(entry) && !(exclude?.test(entry) ?? false));
      expect(line, `pagination row for ${pattern}`).toBeDefined();
      return line!;
    }

    function expectCappedRow(pattern: RegExp, cap: string, exclude?: RegExp): void {
      const line = paginationRow(pattern, exclude);
      expect(line, `cap ${cap} on ${pattern}`).toContain(cap);
      expect(line).toMatch(/cursor|offset/i);
      expect(line).toMatch(/total/i);
    }

    it('keeps the title/version and documents the versioning guarantees', () => {
      expect(doc.info.title).toBe('Photox API');
      expect(doc.info.version).toBe('1.0');
      expect(description().length).toBeGreaterThan(500);
      expect(description()).toMatch(/additive/i);
      expect(description()).toMatch(/\/api\/v2/);
      expect(description()).toMatch(/stable/i);
      expect(description()).toMatch(/closed/i);
    });

    it('freezes /api/share/* and marks /worker and /health internal', () => {
      expect(description()).toMatch(/\/api\/share/);
      expect(description()).toMatch(/frozen/i);
      expect(description()).toMatch(/\/worker/);
      expect(description()).toMatch(/\/health/);
      expect(description()).toMatch(/internal/i);
    });

    it('documents last-write-wins JSON PATCH without validators', () => {
      expect(description()).toMatch(/last[- ]write[- ]wins/i);
      expect(description()).toMatch(/If-Match/);
      expect(description()).toMatch(/ETag/);
    });

    it('lists every collection with its walk mode, actual cap and total meaning', () => {
      expect(description()).toMatch(/walk/i);
      expectCappedRow(/\bassets\b/i, '100', /album assets|admin users|backup/i);
      expectCappedRow(/\bsearch\b/i, '100');
      expectCappedRow(/admin users/i, '50');
      expectCappedRow(/\balbums\b/i, '1000', /album assets/i);
      expectCappedRow(/\bpersons\b/i, '1000');
      expectCappedRow(/album assets/i, '100');
      expectCappedRow(/\bshares\b/i, '200');
      expectCappedRow(/overview/i, '1000');
    });

    it('documents the deprecation policy', () => {
      expect(description()).toMatch(/deprecat/i);
      expect(description()).toMatch(/Sunset/);
      expect(description()).toMatch(/at least one release|one release/i);
      expect(description()).toMatch(/next major/i);
    });

    it('documents the envelope and problem+json negotiation', () => {
      expect(description()).toMatch(/application\/problem\+json/);
      expect(description()).toMatch(/7807/);
      expect(description()).toMatch(/application\/json/);
      expect(description()).toMatch(/Accept/);
    });

    it('renders in Swagger UI', async () => {
      const res = await request(apiServer(t)).get('/docs');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });
  });

  describe('problem+json negotiation over HTTP', () => {
    it('answers application/problem+json with the envelope plus status/detail aliases', async () => {
      const res = await request(apiServer(t))
        .get('/api/v1/assets')
        .set('Accept', 'application/problem+json');

      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        status: 401,
      });
      expect((res.body as { detail?: string }).detail).toBe(
        (res.body as { message?: string }).message,
      );
      expect((res.body as { status?: number }).status).toBe(
        (res.body as { statusCode?: number }).statusCode,
      );
      expect(typeof (res.body as { requestId?: unknown }).requestId).toBe('string');
    });

    it('matches the Accept media type case-insensitively with parameters', async () => {
      const res = await request(apiServer(t))
        .get('/api/v1/assets')
        .set('Accept', 'text/html, Application/Problem+JSON; q=0.9');

      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect((res.body as { status?: number }).status).toBe(401);
    });

    it('keeps the plain application/json body byte-compatible', async () => {
      const res = await request(apiServer(t))
        .get('/api/v1/assets')
        .set('Accept', 'application/json');

      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).not.toHaveProperty('status');
      expect(res.body).not.toHaveProperty('detail');
      expect(res.body).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      });
      expect(Object.keys(res.body as Record<string, unknown>)).toEqual([
        'statusCode',
        'code',
        'message',
        'requestId',
      ]);
    });
  });
});
