import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from '../../src/database/migrations';
import { withAdminDb } from './test-setup';

/**
 * The schema-drift gate. Two databases from one entity list:
 *   - `_mig`  — built by MIGRATIONS, exactly like production.
 *   - `_sync` — built by `synchronize` from the entity metadata.
 * Everything the entity metadata declares must exist in the migrations database with the same
 * column type/nullability and the same unique keys and indexes. Extra things on the migrations
 * side are allowed (foreign keys, hand-written partial indexes) because a `@ManyToOne` cannot
 * express `DEFERRABLE`/`RESTRICT` and some of this schema is deliberately SQL-first.
 *
 * What it catches, in both directions of the mistake: a new entity column/index with no
 * migration (breaks production, passes tests), and an entity that drifted from the SQL that
 * built the database (`asset_thumbnails.assetId` was `varchar` in the entity and `uuid` in the
 * baseline for months). Neither is visible to a spec that only talks HTTP.
 *
 * Names are not compared: a hash name from `synchronize` and an explicit name from a migration
 * are different labels for the same object.
 */
const MIG_DB = 'photox_t_parity_mig';
const SYNC_DB = 'photox_t_parity_sync';

interface TableShape {
  columns: Map<string, string>;
  indexes: Set<string>;
}

function connectionOptions(database: string) {
  return {
    type: 'postgres' as const,
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    username: 'photox',
    password: 'photox',
    database,
  };
}

async function recreate(db: string): Promise<void> {
  await withAdminDb(
    process.env.POSTGRES_HOST ?? 'localhost',
    Number(process.env.POSTGRES_PORT ?? 5432),
    'photox',
    async (ds) => {
      await ds.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await ds.query(`CREATE DATABASE "${db}"`);
    },
  );
}

/** Column type, nullability, unique keys and index definitions — no names, no defaults. */
async function shapeOf(database: string): Promise<Map<string, TableShape>> {
  return withAdminDb(
    process.env.POSTGRES_HOST ?? 'localhost',
    Number(process.env.POSTGRES_PORT ?? 5432),
    database,
    async (ds) => {
      const tables = new Map<string, TableShape>();
      const table = (name: string): TableShape => {
        const existing = tables.get(name);
        if (existing) return existing;
        const created: TableShape = { columns: new Map(), indexes: new Set() };
        tables.set(name, created);
        return created;
      };

      const columns: {
        table_name: string;
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }[] = await ds.query(
        `SELECT table_name, column_name, data_type, udt_name, is_nullable,
                character_maximum_length, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_schema = 'public'`,
      );
      for (const c of columns) {
        table(c.table_name).columns.set(
          c.column_name,
          [
            c.data_type,
            c.udt_name,
            c.is_nullable,
            c.character_maximum_length ?? '',
            c.numeric_precision ?? '',
            c.numeric_scale ?? '',
          ].join('|'),
        );
      }

      // Unique constraints and unique indexes are the same object to the planner (every
      // constraint has a backing index, and this comparison sees both), so comparing pg_index
      // covers PKs, `@Unique` and `@Index({unique})` without the constraint-vs-index false
      // positive that `backup_merges` would otherwise produce.
      const indexes: {
        table_name: string;
        indunique: boolean;
        predicate: string | null;
        cols: string | null;
      }[] = await ds.query(
        `SELECT c.relname AS table_name, i.indisunique,
                pg_get_expr(i.indpred, i.indrelid) AS predicate,
                (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                   FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      );
      for (const i of indexes) {
        if (i.cols === null) continue; // expression index: neither builder creates one
        table(i.table_name).indexes.add(
          `${i.indunique ? 'unique' : 'plain'}:${i.cols}:${i.predicate ?? ''}`,
        );
      }

      return tables;
    },
  );
}

describe('migrations schema parity', () => {
  let migrated: Map<string, TableShape>;
  let synchronized: Map<string, TableShape>;

  beforeAll(async () => {
    await recreate(MIG_DB);
    await recreate(SYNC_DB);

    const migDs = new DataSource({
      ...connectionOptions(MIG_DB),
      entities: ENTITIES,
      migrations: MIGRATIONS,
      migrationsRun: true,
      migrationsTransactionMode: 'each',
      synchronize: false,
    });
    await migDs.initialize();
    await migDs.destroy();

    const syncDs = new DataSource({
      ...connectionOptions(SYNC_DB),
      entities: ENTITIES,
      synchronize: true,
    });
    await syncDs.initialize();
    await syncDs.destroy();

    [migrated, synchronized] = await Promise.all([shapeOf(MIG_DB), shapeOf(SYNC_DB)]);
  }, 120_000);

  afterAll(async () => {
    for (const db of [MIG_DB, SYNC_DB]) {
      await withAdminDb(
        process.env.POSTGRES_HOST ?? 'localhost',
        Number(process.env.POSTGRES_PORT ?? 5432),
        'photox',
        async (ds) => {
          await ds.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
        },
      );
    }
  });

  it('creates every entity table the metadata declares', () => {
    const missing = [...synchronized.keys()].filter((name) => !migrated.has(name));
    expect(missing).toEqual([]);
  });

  it('matches every entity column, key and index', () => {
    const problems: string[] = [];
    for (const [table, shape] of synchronized) {
      const actual = migrated.get(table);
      if (!actual) continue; // reported by the table test

      for (const [column, expected] of shape.columns) {
        const got = actual.columns.get(column);
        if (got === undefined) problems.push(`${table}.${column}: column missing from migrations`);
        else if (got !== expected) problems.push(`${table}.${column}: ${got} != ${expected}`);
      }
      for (const index of shape.indexes) {
        if (!actual.indexes.has(index)) problems.push(`${table}: index ${index} missing`);
      }
    }
    expect(problems).toEqual([]);
  });
});
