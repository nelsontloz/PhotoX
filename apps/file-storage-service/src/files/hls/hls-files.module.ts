import { Module } from '@nestjs/common'
import { StorageModule } from '../../storage/storage.module'
import { HlsFilesService } from './hls-files.service'
import { HlsFilesController } from './hls-files.controller'

@Module({
  imports: [StorageModule],
  providers: [HlsFilesService],
  controllers: [HlsFilesController],
})
export class HlsFilesModule {}
