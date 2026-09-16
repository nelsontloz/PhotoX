import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { loadEnv } from '@photox/shared-config'

@Global()
@Module({})
export class SharedDatabaseModule {
  static forRoot() {
    const env = loadEnv()
    return {
      module: SharedDatabaseModule,
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
      exports: [TypeOrmModule],
    }
  }
}
