import { Module, Global, Logger } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { SharedDatabaseModule } from '@photox/data-access'

// ponytail: 1024 is the `faceres` model output (apps/worker-service/node_modules/@vladmandic/human/models/faceres.json). If the model changes, drop and recreate the index with the new dim.
const VECTOR_INIT_PROVIDER = {
  provide: 'VECTOR_INIT',
  useFactory: (dataSource: DataSource) => {
    return {
      onApplicationBootstrap: async () => {
        try {
          await dataSource.query('CREATE EXTENSION IF NOT EXISTS vector')
          await dataSource.query('DROP INDEX IF EXISTS faces_embedding_hnsw')
          await dataSource.query(
            'CREATE INDEX faces_embedding_hnsw ON faces USING hnsw ((embedding::vector(1024)) vector_cosine_ops)',
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
