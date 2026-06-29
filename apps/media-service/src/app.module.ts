import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { DatabaseModule } from './database/database.module'
import { AssetsModule } from './assets/assets.module'
import { AlbumsModule } from './albums/albums.module'
import { AdminModule } from './admin/admin.module'
import { PersonsModule } from './persons/persons.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule.forRoot('library_db'),
    AssetsModule,
    AlbumsModule,
    AdminModule,
    PersonsModule,
    HealthModule,
  ],
})
export class AppModule {}
