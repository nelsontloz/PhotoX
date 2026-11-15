import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import type { Express } from 'express';
import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthModule } from '../../src/auth/auth.module';
import { HealthModule } from '../../src/health/health.module';
import { BullMqModule } from '../../src/queue/bullmq.module';
import { BullMqService } from '../../src/queue/bullmq.service';
import { setupTestInfra, teardownTestInfra } from './test-setup';

interface HealthBody {
  status: string;
  service: string;
  uptime: number;
  timestamp: string;
  checks: Record<string, { status: string; latencyMs?: number }>;
}

describe('health endpoint', () => {
  let app: INestApplication;
  let redis: Redis;
  let deadRedis: Redis;
  /** The BullMqService override is read per request, so swapping the client is enough. */
  let redisHolder: { redis: Redis };

  beforeAll(async () => {
    const { redisHost, redisPort, redisDb, pgHost, pgPort, pgDb } = await setupTestInfra();
    // stand in for the global BullMqService's shared client
    redis = new Redis({
      host: redisHost,
      port: redisPort,
      db: redisDb,
      maxRetriesPerRequest: null,
    });
    redis.on('error', () => undefined);
    await redis.ping();
    // The shared Redis container stays up for every other spec file, so "Redis is down"
    // is simulated with a client pointed at a closed port instead of stopping it.
    // enableOfflineQueue makes the ping fail fast instead of queueing forever.
    deadRedis = new Redis({
      host: '127.0.0.1',
      port: 1,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    deadRedis.on('error', () => undefined);
    redisHolder = { redis };
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: pgHost,
          port: pgPort,
          username: 'photox',
          password: 'photox',
          database: pgDb,
          // /health only pings the connection — this app registers no entities and needs no
          // tables, but it must not run DDL against the shared container either
          synchronize: false,
          poolSize: 5,
        }),
        // real global guard, so a non-whitelisted /health would come back 401
        AuthModule,
        BullMqModule,
        HealthModule,
      ],
    })
      .overrideProvider(BullMqService)
      .useValue(redisHolder)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    if (redis) redis.disconnect();
    if (deadRedis) deadRedis.disconnect();
    if (app) await app.close();
    await teardownTestInfra();
  });

  it('GET /health is open and reports Postgres + Redis up', async () => {
    const server = app.getHttpServer() as Express;
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    const body = res.body as HealthBody;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('core');
    expect(typeof body.uptime).toBe('number');
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
    expect(body.checks.database?.status).toBe('up');
    expect(body.checks.redis?.status).toBe('up');
  });

  // `/healthz` is a probe alias for `/health`: the same unversioned route, the same status and
  // the same payload. `uptime`/`timestamp` are re-stamped per call, so body equivalence is
  // checked on every field those two do not own, plus on the key sets of both bodies.
  describe('healthz alias', () => {
    const comparable = (body: HealthBody) => ({
      status: body.status,
      service: body.service,
      checks: {
        database: body.checks.database?.status,
        redis: body.checks.redis?.status,
      },
    });

    it('GET /healthz is open at the unversioned path and reports the health payload', async () => {
      redisHolder.redis = redis;
      const server = app.getHttpServer() as Express;
      const res = await request(server).get('/healthz');
      expect(res.status).toBe(200);
      const body = res.body as HealthBody;
      expect(body.status).toBe('ok');
      expect(body.service).toBe('core');
      expect(typeof body.uptime).toBe('number');
      expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
      expect(body.checks.database?.status).toBe('up');
      expect(body.checks.redis?.status).toBe('up');
    });

    it('returns the same status and body as /health for the same state', async () => {
      redisHolder.redis = redis;
      const server = app.getHttpServer() as Express;
      const health = await request(server).get('/health');
      const healthz = await request(server).get('/healthz');
      expect(healthz.status).toBe(health.status);
      expect(healthz.status).toBe(200);
      expect(Object.keys(healthz.body as HealthBody).sort()).toEqual(
        Object.keys(health.body as HealthBody).sort(),
      );
      expect(comparable(healthz.body as HealthBody)).toEqual(comparable(health.body as HealthBody));
    });

    it('mirrors the degraded status of /health while Redis is down', async () => {
      redisHolder.redis = deadRedis;
      const server = app.getHttpServer() as Express;
      const health = await request(server).get('/health');
      const healthz = await request(server).get('/healthz');
      expect(health.status).toBe(200);
      expect(healthz.status).toBe(200);
      expect(comparable(healthz.body as HealthBody)).toEqual(comparable(health.body as HealthBody));
      const body = healthz.body as HealthBody;
      expect(body.status).toBe('degraded');
      expect(body.service).toBe('core');
      expect(body.checks.database?.status).toBe('up');
      expect(body.checks.redis?.status).toBe('down');
    }, 60_000);

    // the alias is unversioned only: registering it under the API prefix would publish a
    // second health surface the policy in open-routes.ts deliberately does not open
    it('does not serve /api/v1/healthz', async () => {
      redisHolder.redis = redis;
      const server = app.getHttpServer() as Express;
      const res = await request(server).get('/api/v1/healthz');
      expect(res.status).toBe(404);
    });
  });

  it('reports degraded with Redis down while Postgres stays up', async () => {
    redisHolder.redis = deadRedis;
    const server = app.getHttpServer() as Express;
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    const body = res.body as HealthBody;
    expect(body.status).toBe('degraded');
    expect(body.service).toBe('core');
    expect(body.checks.database?.status).toBe('up');
    expect(body.checks.redis?.status).toBe('down');
  }, 60_000);
});
