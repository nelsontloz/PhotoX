import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { DatabaseModule } from './database/database.module'
import { TrashModule } from './trash/trash.module'
import { AssetsModule } from './assets/assets.module'
import { AlbumsModule } from './albums/albums.module'
import { AdminModule } from './admin/admin.module'
import { PersonsModule } from './persons/persons.module'
import { SharesModule } from './shares/shares.module'
import { InternalModule } from './internal/internal.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule.forRoot('library_db'),
    TrashModule,
    AssetsModule,
    AlbumsModule,
    AdminModule,
    PersonsModule,
    SharesModule,
    InternalModule,
    HealthModule,
  ],
})
export class AppModule {}
