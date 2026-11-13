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
    t = await createApiTestApp({ mockUser: null, swagger: true });
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
});
