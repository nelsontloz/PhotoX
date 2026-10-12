import { Module } from '@nestjs/common'
import { AssetsModule } from '../assets/assets.module'
import { FacesModule } from '../faces/faces.module'
import { PersonsModule } from '../persons/persons.module'
import { EmbeddingsModule } from '../embeddings/embeddings.module'
import { OcrModule } from '../ocr/ocr.module'
import { DetectionsModule } from '../detections/detections.module'
import { UserFilesModule } from '../files/user/user-files.module'
import { AdminModule as FilesAdminModule } from '../files/admin/admin.module'
import { WorkerController } from './worker.controller'

@Module({
  imports: [
    AssetsModule,
    FacesModule,
    PersonsModule,
    EmbeddingsModule,
    OcrModule,
    DetectionsModule,
    UserFilesModule,
    FilesAdminModule,
  ],
  controllers: [WorkerController],
})
export class WorkerModule {}
