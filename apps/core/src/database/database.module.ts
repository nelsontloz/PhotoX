import { Global, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { insertAdminUser } from '../scripts/admin-seed'
import { postgresConnectionOptions } from '../scripts/postgres-options'

// ponytail: 512 is the InsightFace buffalo_l w600k_r50 output dim.
// Index rebuild fails while legacy 1024-dim rows remain (warn-caught) — the cluster re-embed backfill converts them.
// Each group is best-effort and independent: a failure skips the rest of its statements, later groups still run.
const BOOTSTRAP_SQL: { warn: string; statements: string[] }[] = [
  {
    warn: 'pgvector extension creation failed — vision search will be unavailable',
    statements: ['CREATE EXTENSION IF NOT EXISTS vector', 'ALTER EXTENSION vector UPDATE'],
  },
  {
    warn: 'assets_layout_idx creation failed — layout endpoint falls back to filter+sort',
    statements: [
      // covering index for GET /assets/layout: partial (non-trashed) + COALESCE order keys
      // + INCLUDE makes both the layout fetch and the ETag fingerprint query index-only
      `CREATE INDEX IF NOT EXISTS assets_layout_idx
       ON assets ("userId", (COALESCE("takenAt", "uploadedAt")) DESC, "uploadedAt" DESC)
       INCLUDE ("width", "height", "updatedAt")
       WHERE "isTrashed" = false`,
    ],
  },
  {
    warn: 'asset_embeddings HNSW index creation failed — vision search will be unavailable',
    statements: [
      // vision-search embeddings (SigLIP2-B/16, SEARCH_EMBEDDING_DIM) — hnsw halfvec_cosine_ops
      // is the only index-compatible opclass for the text-stored embedding column.
      // model hardcoded (SEARCH_EMBEDDING_MODEL): ANN over one row set must not mix models
      'DROP INDEX IF EXISTS asset_embeddings_hnsw',
      `CREATE INDEX asset_embeddings_hnsw ON asset_embeddings
       USING hnsw ((embedding::halfvec(768)) halfvec_cosine_ops)
       WHERE kind = 'image' AND model = 'siglip2-b16-224'`,
    ],
  },
  {
    warn: 'cube/earthdistance extension or places GiST index creation failed — place resolution will be unavailable',
    statements: [
      // offline reverse geocoding: nearest GeoNames city per asset coordinate
      'CREATE EXTENSION IF NOT EXISTS cube',
      'CREATE EXTENSION IF NOT EXISTS earthdistance',
      'CREATE INDEX IF NOT EXISTS places_earth_idx ON places USING gist (ll_to_earth(latitude, longitude))',
    ],
  },
]

@Injectable()
export class VectorInitService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DatabaseModule')

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const step of BOOTSTRAP_SQL) {
      try {
        for (const sql of step.statements) await this.dataSource.query(sql)
      } catch {
        this.logger.warn(step.warn)
      }
    }
  }
}

// Env-gated admin seed (same direct-process.env precedent as WORKER_SERVICE_PORT, not zod): empty
// env is a no-op so dev/CI are untouched; the e2e compose stack sets both. Seeding here (not open
// registration) is the only way to mint an admin now that registration always yields 'user'.
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DatabaseModule')

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = process.env.ADMIN_EMAIL
    const password = process.env.ADMIN_PASSWORD
    if (!email && !password) return
    if (!email || !password) {
      this.logger.warn('ADMIN_EMAIL/ADMIN_PASSWORD partially set — skipping admin seed')
      return
    }
    try {
      const existing: unknown[] = await this.dataSource.query(
        `SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`,
      )
      if (existing.length > 0) return
      await insertAdminUser(this.dataSource, email, password)
      this.logger.log(`Seeded admin user ${email} from ADMIN_EMAIL`)
    } catch {
      this.logger.warn(
        'Admin seed failed — register a user and promote it, or retry with ADMIN_* set',
      )
    }
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot() {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRoot({
          ...postgresConnectionOptions(),
          autoLoadEntities: true,
          // ponytail: synchronize is dev/test-only (same direct-process.env precedent as
          // ADMIN_EMAIL above) — prod boots via the baseline migration (migrationsRun).
          synchronize: process.env.NODE_ENV !== 'production',
          migrationsRun: process.env.NODE_ENV === 'production',
          migrations: [`${__dirname}/migrations/*.{js,ts}`],
          connectTimeoutMS: 3000,
          retryAttempts: 3,
          retryDelay: 3000,
        }),
      ],
      providers: [VectorInitService, AdminSeedService],
      exports: [TypeOrmModule],
    }
  }
}
