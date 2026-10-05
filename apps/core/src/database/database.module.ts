import { Module, Global, Logger } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { loadEnv } from '@photox/shared-config'

// ponytail: 512 is the InsightFace buffalo_l w600k_r50 output dim (replaced human faceres 1024).
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

const VECTOR_INIT_PROVIDER = {
  provide: 'VECTOR_INIT',
  useFactory: (dataSource: DataSource) => {
    return {
      onApplicationBootstrap: async () => {
        const logger = new Logger('DatabaseModule')
        for (const step of BOOTSTRAP_SQL) {
          try {
            for (const sql of step.statements) await dataSource.query(sql)
          } catch {
            logger.warn(step.warn)
          }
        }
      },
    }
  },
  inject: [DataSource],
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot() {
    const env = loadEnv()
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: env.POSTGRES_HOST,
          port: env.POSTGRES_PORT,
          username: env.POSTGRES_USER,
          password: env.POSTGRES_PASSWORD,
          database: 'photox',
          autoLoadEntities: true,
          synchronize: true,
          connectTimeoutMS: 3000,
          retryAttempts: 3,
          retryDelay: 3000,
        }),
      ],
      providers: [VECTOR_INIT_PROVIDER],
      exports: [TypeOrmModule],
    }
  }
}
