import { Module, Global, Logger } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { loadEnv } from '@photox/shared-config'

// ponytail: 512 is the InsightFace buffalo_l w600k_r50 output dim (replaced human faceres 1024).
// Index rebuild fails while legacy 1024-dim rows remain (warn-caught) — the cluster re-embed backfill converts them.
const VECTOR_INIT_PROVIDER = {
  provide: 'VECTOR_INIT',
  useFactory: (dataSource: DataSource) => {
    return {
      onApplicationBootstrap: async () => {
        try {
          await dataSource.query('CREATE EXTENSION IF NOT EXISTS vector')
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
