import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { DatabaseModule } from './database/database.module'
import { StorageModule } from './storage/storage.module'
import { UserFilesModule } from './files/user/user-files.module'
import { HlsFilesModule } from './files/hls/hls-files.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule.forRoot('files_db'),
    StorageModule,
    UserFilesModule,
    HlsFilesModule,
    HealthModule,
  ],
})
export class AppModule {}
