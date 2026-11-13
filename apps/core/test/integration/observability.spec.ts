import request from 'supertest';
import { apiServer, closeTestApp, createApiTestApp, type ApiTestApp } from './helpers';

describe('observability surface', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp();
  });

  afterAll(async () => {
    await closeTestApp(t);
  });

  it('serves liveness and readiness probes', async () => {
    await request(apiServer(t)).get('/health/live').expect(200).expect({ status: 'ok' });

    const ready = await request(apiServer(t)).get('/health/ready');
    // 503 is the correct answer when Redis/Postgres are down; here both are up
    expect([200, 503]).toContain(ready.status);
    expect(ready.body).toHaveProperty('checks.database.status');
    expect(ready.body).toHaveProperty('checks.redis.status');
  });

  it('exposes Prometheus counters labelled by route template, not raw path', async () => {
    await request(apiServer(t)).get('/health').expect(200);

    const metrics = await request(apiServer(t)).get('/metrics').expect(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.text).toContain('photox_http_requests_total');
    expect(metrics.text).toContain('route="/health"');
    expect(metrics.text).toContain('photox_http_request_duration_ms_count');
    // a concrete path would defeat the point: no digits in the recorded template
    expect(metrics.text).not.toMatch(/route="[^"]*\/\d+"/);
  });
});
