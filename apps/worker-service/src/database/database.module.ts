import { DynamicModule, Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { loadEnv } from '@photox/shared-config'

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(database: string): DynamicModule {
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
          database,
          autoLoadEntities: true,
          synchronize: true,
          retryAttempts: 3,
          retryDelay: 3000,
          connectTimeoutMS: 3000,
        }),
      ],
      exports: [TypeOrmModule],
    }
  }
}
