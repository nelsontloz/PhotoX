import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { DatabaseModule } from './database/database.module'
import { StorageModule } from './storage/storage.module'
import { UserFilesModule } from './files/user/user-files.module'
import { InternalFilesModule } from './files/internal/internal-files.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule.forRoot('files_db'),
    StorageModule,
    UserFilesModule,
    InternalFilesModule,
    HealthModule,
  ],
})
export class AppModule {}
