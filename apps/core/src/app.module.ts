import { Module } from '@nestjs/common';
import { loadRootEnvFile } from '@photox/shared-config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { BullMqModule } from './queue/bullmq.module';
import { UsersModule } from './users/users.module';
import { UserFilesModule } from './files/user/user-files.module';
import { UploadsModule } from './uploads/uploads.module';
import { AssetsModule } from './assets/assets.module';
import { AlbumsModule } from './albums/albums.module';
import { SharesModule } from './shares/shares.module';
import { FacesModule } from './faces/faces.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { SearchModule } from './search/search.module';
import { DetectionsModule } from './detections/detections.module';
import { GroupsModule } from './groups/groups.module';
import { PersonsModule } from './persons/persons.module';
import { AdminModule } from './admin/admin.module';
import { WorkerModule } from './worker/worker.module';
import { BackupModule } from './backup/backup.module';

// runs before DatabaseModule.forRoot()'s loadEnv() below — replicates @nestjs/config's envFilePath
loadRootEnvFile();

@Module({
  imports: [
    DatabaseModule.forRoot(),
    HealthModule,
    AuthModule,
    BullMqModule,
    UsersModule,
    UserFilesModule,
    UploadsModule,
    AssetsModule,
    AlbumsModule,
    SharesModule,
    FacesModule,
    EmbeddingsModule,
    SearchModule,
    DetectionsModule,
    GroupsModule,
    PersonsModule,
    AdminModule,
    WorkerModule,
    BackupModule,
  ],
})
export class AppModule {}
