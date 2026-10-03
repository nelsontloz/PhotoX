import { Module } from '@nestjs/common'
import { loadRootEnvFile } from '@photox/shared-config'
import { DatabaseModule } from './database/database.module'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { BullMqModule } from './queue/bullmq.module'
import { UsersModule } from './users/users.module'
import { StorageModule } from './files/storage/storage.module'
import { UserFilesModule } from './files/user/user-files.module'
import { AdminModule as FilesAdminModule } from './files/admin/admin.module'
import { AssetsModule } from './assets/assets.module'
import { AlbumsModule } from './albums/albums.module'
import { SharesModule } from './shares/shares.module'
import { FacesModule } from './faces/faces.module'
import { EmbeddingsModule } from './embeddings/embeddings.module'
import { SearchModule } from './search/search.module'
import { PersonsModule } from './persons/persons.module'
import { AdminModule } from './admin/admin.module'

// runs before DatabaseModule.forRoot()'s loadEnv() below — replicates @nestjs/config's envFilePath
loadRootEnvFile()

@Module({
  imports: [
    DatabaseModule.forRoot(),
    HealthModule,
    AuthModule,
    BullMqModule,
    UsersModule,
    StorageModule,
    UserFilesModule,
    FilesAdminModule,
    AssetsModule,
    AlbumsModule,
    SharesModule,
    FacesModule,
    EmbeddingsModule,
    SearchModule,
    PersonsModule,
    AdminModule,
  ],
})
export class AppModule {}
