import request from 'supertest';
import { apiServer, closeTestApp, createApiTestApp, resetDb, seedUser } from './helpers';
import type { ApiTestApp } from './helpers';

/**
 * The API-wide error contract: every non-2xx body is
 * `{statusCode, code, message, details?, retryAfterSec?, requestId}` — one shape, stable codes,
 * no Nest `error` reason phrase. Also covers the OpenAPI error component and cookie security
 * scheme, since both are part of the same published contract.
 */
describe('API error contract', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({ swagger: true });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
  });

  function expectEnvelope(body: unknown, status: number, code: string) {
    const envelope = body as Record<string, unknown>;
    expect(envelope.statusCode).toBe(status);
    expect(envelope.code).toBe(code);
    expect(typeof envelope.message).toBe('string');
    expect(envelope.message).not.toBe('');
    // Nest's reason phrase is transport noise; the contract has one code.
    expect(envelope).not.toHaveProperty('error');
    expect(typeof envelope.requestId).toBe('string');
  }

  it('answers an unauthenticated request with UNAUTHENTICATED', async () => {
    const res = await request(apiServer(t)).get('/api/v1/assets');
    expect(res.status).toBe(401);
    expectEnvelope(res.body, 401, 'UNAUTHENTICATED');
  });

  it('rejects anonymous access to every guarded resource family', async () => {
    const routes: { method: 'get' | 'post' | 'delete'; path: string }[] = [
      { method: 'get', path: '/api/v1/albums' },
      { method: 'post', path: '/api/v1/albums' },
      { method: 'get', path: '/api/v1/shares' },
      { method: 'delete', path: '/api/v1/shares/00000000-0000-0000-0000-000000000000' },
      { method: 'get', path: '/api/v1/persons' },
      { method: 'get', path: '/api/v1/admin/users' },
      { method: 'get', path: '/api/v1/files/00000000-0000-0000-0000-000000000000/stream' },
    ];

    // every route is probed before asserting, so one run reports every failing family
    const results = await Promise.all(
      routes.map(async ({ method, path }) => {
        const res = await request(apiServer(t))[method](path);
        return {
          route: `${method.toUpperCase()} ${path}`,
          status: res.status,
          body: res.body as unknown,
        };
      }),
    );

    const notUnauthenticated = results
      .filter((r) => r.status !== 401)
      .map((r) => `${r.route} -> ${r.status}`);
    expect(notUnauthenticated).toEqual([]);
    for (const result of results) expectEnvelope(result.body, 401, 'UNAUTHENTICATED');
  });

  it('answers an admin route reached by a user with FORBIDDEN', async () => {
    const user = await seedUser(t);
    const res = await request(apiServer(t))
      .get('/api/v1/admin/face-detection')
      .set(t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role })));
    expect(res.status).toBe(403);
    expectEnvelope(res.body, 403, 'FORBIDDEN');
  });

  it('answers a missing resource with NOT_FOUND, not a uuid-cast 500', async () => {
    const user = await seedUser(t);
    const res = await request(apiServer(t))
      .get('/api/v1/assets/not-a-uuid')
      .set(t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role })));
    expect(res.status).toBe(404);
    expectEnvelope(res.body, 404, 'NOT_FOUND');
  });

  it('404s a share token that never existed', async () => {
    const res = await request(apiServer(t)).get('/api/share/never-existed-6f1c2a4e');
    expect(res.status).toBe(404);
    expectEnvelope(res.body, 404, 'NOT_FOUND');
  });

  it('answers an unmatched path with the same envelope', async () => {
    const res = await request(apiServer(t)).get('/api/v1/definitely-not-a-route');
    expect(res.status).toBe(404);
    expectEnvelope(res.body, 404, 'NOT_FOUND');
  });

  it('splits a validation failure into details with field paths', async () => {
    const user = await seedUser(t);
    const res = await request(apiServer(t))
      .get('/api/v1/assets?limit=0')
      .set(t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role })));

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'VALIDATION_FAILED');
    expect((res.body as { details?: unknown }).details).toEqual([
      expect.objectContaining({ field: 'limit' }),
    ]);
  });

  it('reports a forbidden extra query field as a validation detail', async () => {
    const user = await seedUser(t);
    const res = await request(apiServer(t))
      .get('/api/v1/assets?limit=5&notAField=1')
      .set(t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role })));

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'VALIDATION_FAILED');
    expect((res.body as { details?: unknown }).details).toEqual([
      expect.objectContaining({ field: 'notAField' }),
    ]);
  });

  it('answers 429 with RATE_LIMITED, Retry-After and retryAfterSec', async () => {
    const email = 'contract-limit@example.com';
    await request(apiServer(t))
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123', displayName: 'Limit' });

    const login = () =>
      request(apiServer(t)).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });

    for (let attempt = 0; attempt < 5; attempt++) await login();
    const res = await login();

    expect(res.status).toBe(429);
    expectEnvelope(res.body, 429, 'RATE_LIMITED');
    expect(typeof (res.body as { retryAfterSec?: unknown }).retryAfterSec).toBe('number');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('publishes the error component and the cookie credential in /docs-json', async () => {
    const res = await request(apiServer(t)).get('/docs-json');
    expect(res.status).toBe(200);

    const doc = res.body as {
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
        securitySchemes: Record<string, unknown>;
      };
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };

    expect(doc.components.schemas.ApiError?.properties?.code).toBeDefined();
    expect(doc.components.securitySchemes.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'photox_access',
    });

    const assetsList = doc.paths['/api/v1/assets']?.get;
    expect(assetsList?.responses?.['401']).toBeDefined();
    expect(assetsList?.responses?.['500']).toBeDefined();
    expect(assetsList?.responses?.['400']).toBeDefined();
  });

  it('publishes the full operation contract: auth, headers, byte semantics and parameter types', async () => {
    const res = await request(apiServer(t)).get('/docs-json');
    expect(res.status).toBe(200);

    const doc = res.body as {
      components: { securitySchemes: Record<string, unknown> };
      paths: Record<
        string,
        Record<
          string,
          {
            security?: unknown;
            parameters?: {
              name?: string;
              in?: string;
              schema?: { type?: string; format?: string };
            }[];
            responses?: Record<string, { headers?: Record<string, unknown> }>;
            requestBody?: {
              content?: Record<string, { schema?: { type?: string; format?: string } }>;
            };
          }
        >
      >;
    };

    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
    expect(doc.components.securitySchemes.bearer).toBeUndefined();
    expect(doc.paths['/api/v1/auth/login']!.post!.security).toEqual([]);
    expect(doc.paths['/worker/assets']!.get!.security).toEqual([
      { bearerAuth: [], workerJobSignature: [] },
    ]);

    expect(doc.paths['/api/v1/files']!.post!.responses!['201']!.headers!.Location).toBeDefined();
    expect(
      doc.paths['/api/v1/auth/login']!.post!.responses!['200']!.headers!['Set-Cookie'],
    ).toBeDefined();
    expect(doc.paths['/api/v1/files/{fileId}/stream']!.get!.responses!['304']).toBeDefined();
    expect(doc.paths['/api/v1/files/{fileId}/stream']!.get!.parameters!.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Range', 'If-None-Match']),
    );

    const limit = doc.paths['/api/v1/assets']!.get!.parameters!.find((p) => p.name === 'limit');
    expect(limit?.schema?.type).toBe('integer');
    const assetId = doc.paths['/api/v1/assets/{id}']!.get!.parameters!.find((p) => p.name === 'id');
    expect(assetId?.schema?.format).toBe('uuid');

    const part = doc.paths['/api/v1/uploads/{uploadId}/parts/{index}']!.put!;
    expect(part.requestBody?.content?.['application/octet-stream']?.schema).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect(part.parameters?.find((p) => p.name === 'index')?.schema?.type).toBe('integer');
  });

  it('serves the negotiated error media type the document declares', async () => {
    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .set('Accept', 'application/problem+json');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect((res.body as { code: string }).code).toBe('UNAUTHENTICATED');

    const doc = (await request(apiServer(t)).get('/docs-json')).body as {
      paths: Record<string, Record<string, { responses?: Record<string, { content?: object }> }>>;
    };
    expect(Object.keys(doc.paths['/api/v1/assets']!.get!.responses!['401']!.content!)).toEqual([
      'application/json',
      'application/problem+json',
    ]);
  });

  it('gives every operation a unique, codegen-friendly operationId', async () => {
    const doc = (await request(apiServer(t)).get('/docs-json')).body as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const operationIds: string[] = [];
    for (const pathItem of Object.values(doc.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (operation.operationId) operationIds.push(operation.operationId);
      }
    }
    expect(operationIds.length).toBeGreaterThan(80);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    for (const id of operationIds) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
  });
});
