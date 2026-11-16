import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boots the BUILT core (dist, so the Nest Swagger CLI plugin has run) against throwaway
 * Postgres/Redis containers and exports `/docs-json` to the git-ignored `.openapi/openapi.json`.
 * The source tree cannot be used here: the plugin enriches schemas from the DTO metadata at
 * compile time, and a source-run document is missing formats, bounds and patterns.
 *
 * Requires Docker/Podman (the same requirement as the integration suite). Ryuk runs privileged
 * by default because rootless Podman on macOS cannot reach the socket otherwise; an explicit
 * TESTCONTAINERS_* setting in the environment still wins.
 */

process.env.TESTCONTAINERS_RYUK_PRIVILEGED ??= 'true';
const { GenericContainer } = await import('testcontainers');

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUTPUT = join(ROOT, '.openapi', 'openapi.json');
const storageDir = await mkdtemp(join(tmpdir(), 'photox-openapi-'));

const postgres = await new GenericContainer('pgvector/pgvector:0.8.7-pg16')
  .withExposedPorts(5432)
  .withEnvironment({
    POSTGRES_USER: 'photox',
    POSTGRES_PASSWORD: 'photox',
    POSTGRES_DB: 'photox',
  })
  .start();

const redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

process.env.NODE_ENV = 'test';
process.env.POSTGRES_HOST = postgres.getHost();
process.env.POSTGRES_PORT = String(postgres.getMappedPort(5432));
process.env.POSTGRES_USER = 'photox';
process.env.POSTGRES_PASSWORD = 'photox';
process.env.POSTGRES_DB = 'photox';
process.env.REDIS_HOST = redis.getHost();
process.env.REDIS_PORT = String(redis.getMappedPort(6379));
process.env.REDIS_DB = '0';
delete process.env.REDIS_PASSWORD;
process.env.AUTH_TOKEN_SECRET = 'dev-auth-secret-32-characters-minimum!!';
process.env.WORKER_JWT_SECRET = 'dev-worker-secret-32-characters-minimum!!';
process.env.STORAGE_DIR = storageDir;

let app;
try {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module.js');
  const { setupSwagger } = await import('../dist/swagger/setup.js');

  app = await NestFactory.create(AppModule, { logger: false });
  setupSwagger(app);
  await app.listen(0, '127.0.0.1');

  const response = await fetch(`${await app.getUrl()}/docs-json`);
  if (!response.ok) throw new Error(`/docs-json answered ${response.status}`);

  const document = await response.json();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI written to ${OUTPUT}`);
} finally {
  if (app) await app.close();
  await Promise.all([redis.stop(), postgres.stop()]);
  await rm(storageDir, { recursive: true, force: true });
}
