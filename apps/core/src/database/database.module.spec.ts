import type { Mock } from 'vitest';
import { vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import {
  AdminSeedService,
  DatabaseModule,
  VectorInitService,
  typeOrmOptions,
} from './database.module';
import { MIGRATIONS } from './migrations';
import { StructuralIndexes1794500000000 } from './migrations/1794500000000-StructuralIndexes';

const EMAIL = 'admin-seed@example.com';
const PASSWORD = 'seed-password-123';

describe('VectorInitService bootstrap', () => {
  it('creates the versioned hnsw index before retiring the old name', async () => {
    const sql: string[] = [];
    const query = vi.fn((statement: string) => {
      sql.push(statement.replace(/\s+/g, ' ').trim());
      return Promise.resolve([]);
    });
    await new VectorInitService({ query } as unknown as DataSource).onApplicationBootstrap();

    const create = sql.findIndex((statement) => statement.includes('asset_embeddings_hnsw_v1'));
    const drop = sql.findIndex((statement) =>
      /^DROP INDEX IF EXISTS asset_embeddings_hnsw$/.test(statement),
    );
    expect(create).toBeGreaterThanOrEqual(0);
    // never rebuilt on a boot: the versioned name only builds when it is missing
    expect(sql[create]).toContain('CREATE INDEX IF NOT EXISTS');
    // the old unversioned index is retired only after the replacement exists
    expect(drop).toBeGreaterThan(create);
  });
});

describe('AdminSeedService bootstrap', () => {
  const prevEmail = process.env.ADMIN_EMAIL;
  const prevPassword = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
  });

  afterAll(() => {
    if (prevEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = prevEmail;
    if (prevPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevPassword;
  });

  function bootstrap(query: Mock) {
    const service = new AdminSeedService({ query } as unknown as DataSource);
    return service.onApplicationBootstrap();
  }

  it('is a no-op when neither ADMIN_EMAIL nor ADMIN_PASSWORD is set', async () => {
    const query = vi.fn();
    await bootstrap(query);
    expect(query).not.toHaveBeenCalled();
  });

  it('skips on partial env without touching the database', async () => {
    process.env.ADMIN_EMAIL = EMAIL;
    const query = vi.fn();
    await bootstrap(query);
    expect(query).not.toHaveBeenCalled();
  });

  it('inserts the admin with a verifiable argon2 hash when no admin exists', async () => {
    process.env.ADMIN_EMAIL = EMAIL;
    process.env.ADMIN_PASSWORD = PASSWORD;
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await bootstrap(query);
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1] as [string, [string, string, string]];
    expect(sql).toMatch(/role.*admin/);
    expect(params[1]).toBe(EMAIL);
    expect(await argon2.verify(params[2], PASSWORD)).toBe(true);
  });

  it('does nothing when an admin already exists', async () => {
    process.env.ADMIN_EMAIL = EMAIL;
    process.env.ADMIN_PASSWORD = PASSWORD;
    const query = vi.fn().mockResolvedValueOnce([{ '?column?': 1 }]);
    await bootstrap(query);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('schema ownership', () => {
  function findOption(node: unknown, key: string, seen = new Set<unknown>()): unknown {
    if (node === null || typeof node !== 'object' || seen.has(node)) return undefined;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    if (key in rec) return rec[key];
    for (const v of Object.values(rec)) {
      const r = findOption(v, key, seen);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  // Both used to be environment-gated, which is how the entity metadata and the migrations
  // drifted apart: dev/test ran a schema nobody had written a migration for.
  it('never synchronizes, in any environment', () => {
    expect(findOption(DatabaseModule.forRoot(), 'synchronize')).toBe(false);
    expect(typeOrmOptions().synchronize).toBe(false);
  });

  it('runs the declared migrations everywhere', () => {
    expect(findOption(DatabaseModule.forRoot(), 'migrationsRun')).toBe(true);
    expect(typeOrmOptions().migrations).toBe(MIGRATIONS);
  });
});

describe('migrations list', () => {
  it('registers every migration file, in timestamp order', () => {
    const files = readdirSync(join(__dirname, 'migrations'))
      .filter((file) => /^\d+-.+\.(ts|js)$/.test(file))
      .sort();
    expect(MIGRATIONS).toHaveLength(files.length);
    // a migration appended out of order runs out of order; the class name carries the timestamp
    files.forEach((file, index) => {
      const timestamp = file.split('-')[0];
      expect(MIGRATIONS[index]!.name.endsWith(timestamp!)).toBe(true);
    });
  });
});

describe('typeOrmOptions', () => {
  it('lets a migration opt out of its transaction', () => {
    // TypeORM refuses a per-migration override under its 'all' default, so the CONCURRENTLY
    // index build would fail every production boot with ForbiddenTransactionModeOverrideError.
    expect(typeOrmOptions().migrationsTransactionMode).toBe('each');
    expect(new StructuralIndexes1794500000000().transaction).toBe(false);
  });
});
