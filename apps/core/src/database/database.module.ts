import { Module, Global, Logger } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { loadEnv } from '@photox/shared-config'
import { AssetEmbedding } from './entities/asset-embedding.entity'
import { AssetOcr } from './entities/asset-ocr.entity'
import { AssetDetection } from './entities/asset-detection.entity'
import { Place } from './entities/place.entity'

// ponytail: 512 is the InsightFace buffalo_l w600k_r50 output dim (replaced human faceres 1024).
// Index rebuild fails while legacy 1024-dim rows remain (warn-caught) — the cluster re-embed backfill converts them.
const VECTOR_INIT_PROVIDER = {
  provide: 'VECTOR_INIT',
  useFactory: (dataSource: DataSource) => {
    return {
      onApplicationBootstrap: async () => {
        try {
          await dataSource.query('CREATE EXTENSION IF NOT EXISTS vector')
          // idempotent: existing deployments pick up SQL-side fixes on a pgvector image bump
          await dataSource.query('ALTER EXTENSION vector UPDATE')
          await dataSource.query('DROP INDEX IF EXISTS faces_embedding_hnsw')
          await dataSource.query(
            'CREATE INDEX faces_embedding_hnsw ON faces USING hnsw ((embedding::vector(512)) vector_cosine_ops)',
          )
        } catch {
          new Logger('DatabaseModule').warn(
            'pgvector extension or index creation failed — faces embedding search will be unavailable',
          )
        }

        try {
          // covering index for GET /assets/layout: partial (non-trashed) + COALESCE order keys
          // + INCLUDE makes both the layout fetch and the ETag fingerprint query index-only
          await dataSource.query(
            `CREATE INDEX IF NOT EXISTS assets_layout_idx
             ON assets ("userId", (COALESCE("takenAt", "uploadedAt")) DESC, "uploadedAt" DESC)
             INCLUDE ("width", "height", "updatedAt")
             WHERE "isTrashed" = false`,
          )
        } catch {
          new Logger('DatabaseModule').warn(
            'assets_layout_idx creation failed — layout endpoint falls back to filter+sort',
          )
        }

        try {
          // vision-search embeddings (SigLIP2-B/16, SEARCH_EMBEDDING_DIM) — hnsw halfvec_cosine_ops
          // is the only index-compatible opclass for the text-stored embedding column.
          // model hardcoded (SEARCH_EMBEDDING_MODEL): ANN over one row set must not mix models
          await dataSource.query('DROP INDEX IF EXISTS asset_embeddings_hnsw')
          await dataSource.query(
            `CREATE INDEX asset_embeddings_hnsw ON asset_embeddings
             USING hnsw ((embedding::halfvec(768)) halfvec_cosine_ops)
             WHERE kind = 'image' AND model = 'siglip2-b16-224'`,
          )
        } catch {
          new Logger('DatabaseModule').warn(
            'asset_embeddings HNSW index creation failed — vision search will be unavailable',
          )
        }

        try {
          await dataSource.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
          await dataSource.query('DROP INDEX IF EXISTS asset_ocr_fts_idx')
          await dataSource.query(
            `CREATE INDEX asset_ocr_fts_idx ON asset_ocr USING gin (to_tsvector('simple', text))`,
          )
          await dataSource.query('DROP INDEX IF EXISTS asset_ocr_trgm_idx')
          await dataSource.query(
            'CREATE INDEX asset_ocr_trgm_idx ON asset_ocr USING gin (text gin_trgm_ops)',
          )
        } catch {
          new Logger('DatabaseModule').warn(
            'asset_ocr full-text/trigram index creation failed — OCR search will fall back to scans',
          )
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
        // vision-search tables have no feature module yet; forFeature here makes synchronize
        // create them (autoLoadEntities only picks up forFeature-registered entities)
        TypeOrmModule.forFeature([AssetEmbedding, AssetOcr, AssetDetection, Place]),
      ],
      providers: [VECTOR_INIT_PROVIDER],
      exports: [TypeOrmModule],
    }
  }
}
