import request from 'supertest';
import { DEPRECATED_ON, DEPRECATIONS, toDocPath } from '../../src/common/deprecations';
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
import type { User } from '../../src/database/entities/user.entity';

/**
 * The deprecation contract: every path in the registry exists on the document and is flagged there,
 * every deprecated route answers with `Deprecation`/`Sunset`/`Link`, and its replacement answers
 * without them. Driven from the registry, so a typo'd path fails here instead of silently
 * deprecating nothing.
 */
describe('API deprecations', () => {
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

  async function seedCaller(): Promise<{ user: User; auth: Record<string, string> }> {
    const user = await seedUser(t);
    return {
      user,
      auth: t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role })),
    };
  }

  it('marks every registry entry deprecated on /docs-json', async () => {
    const doc = (await request(apiServer(t)).get('/docs-json')).body as {
      paths: Record<
        string,
        Record<string, { deprecated?: boolean; 'x-sunset'?: string; 'x-replacement'?: string }>
      >;
    };

    for (const deprecation of DEPRECATIONS) {
      const operation = doc.paths[toDocPath(deprecation.path)]?.[deprecation.method.toLowerCase()];
      const label = `${deprecation.method} ${deprecation.path}`;
      expect(operation, `${label} is missing from the document`).toBeDefined();
      expect(operation!.deprecated, label).toBe(true);
      expect(operation!['x-sunset'], label).toBe(deprecation.sunset);
      expect(operation!['x-replacement'], label).toBe(
        `${deprecation.replacement!.method} ${deprecation.replacement!.path}`,
      );
    }
  });

  it('serves the replacement and the deprecated alias with the same status, announcing only the alias', async () => {
    const { user, auth } = await seedCaller();
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id);
    const sunset = DEPRECATIONS.find((d) => d.path === '/api/v1/assets/bulk-trash')!.sunset;

    const server = apiServer(t);
    const replacement = await request(server)
      .post('/api/v1/assets/trash')
      .set(auth)
      .send({ assetIds: [asset.id] });
    expect(replacement.status).toBe(204);
    expect(replacement.headers.sunset).toBeUndefined();
    expect(replacement.headers.deprecation).toBeUndefined();

    const deprecated = await request(server)
      .post('/api/v1/assets/bulk-trash')
      .set(auth)
      .send({ assetIds: [asset.id] });
    expect(deprecated.status).toBe(204);
    expect(deprecated.headers.deprecation).toBe(
      `@${Math.floor(new Date(DEPRECATED_ON).getTime() / 1000)}`,
    );
    expect(deprecated.headers.sunset).toBe(new Date(sunset).toUTCString());
    expect(deprecated.headers.link).toBe('</api/v1/assets/trash>; rel="successor-version"');
  });

  it('keeps deprecated byte aliases working while announcing the successor', async () => {
    const { user, auth } = await seedCaller();
    const file = await seedFile(t, user.id, { bytes: Buffer.from('bytes') });
    const asset = await seedAsset(t, user.id, file.id);

    const server = apiServer(t);
    const fresh = await request(server)
      .get(`/api/v1/assets/${asset.id}/content?download=true`)
      .set(auth);
    expect(fresh.status).toBe(200);
    expect(fresh.headers['content-disposition']).toMatch(/^attachment; filename="photo\.png"/);
    expect(fresh.headers.sunset).toBeUndefined();

    const deprecated = await request(server)
      .get(`/api/v1/assets/${asset.id}/content/download`)
      .set(auth);
    expect(deprecated.status).toBe(200);
    expect(deprecated.headers.sunset).toBeDefined();
    expect(Buffer.compare(deprecated.body as Buffer, fresh.body as Buffer)).toBe(0);
  });
});
