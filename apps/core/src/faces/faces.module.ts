import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Face } from '../database/entities'
import { Person } from '../database/entities'
import { Asset } from '../database/entities'
import { FileRecord } from '../database/entities'
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
