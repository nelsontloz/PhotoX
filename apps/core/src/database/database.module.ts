import { Module, Global, Logger } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { SharedDatabaseModule } from '@photox/data-access'

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
      },
    }
  },
  inject: [DataSource],
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot() {
    const base = SharedDatabaseModule.forRoot()
    return {
      module: DatabaseModule,
      imports: base.imports,
      providers: [VECTOR_INIT_PROVIDER],
      exports: [TypeOrmModule],
    }
  }
}
