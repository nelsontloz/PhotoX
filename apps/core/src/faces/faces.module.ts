import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Face } from '@photox/data-access'
import { Person } from '@photox/data-access'
import { Asset } from '@photox/data-access'
import { FileRecord } from '@photox/data-access'
import { StorageModule } from '../files/storage/storage.module'
import { FacesController } from './faces.controller'
import { FacesQueryController } from './faces-query.controller'
import { FaceThumbController } from './face-thumb.controller'
import { FacesService } from './faces.service'
import { FaceThumbService } from './face-thumb.service'

@Module({
  imports: [TypeOrmModule.forFeature([Face, Person, Asset, FileRecord]), StorageModule],
  controllers: [FacesController, FacesQueryController, FaceThumbController],
  providers: [FacesService, FaceThumbService],
  exports: [FacesService],
})
export class FacesModule {}
