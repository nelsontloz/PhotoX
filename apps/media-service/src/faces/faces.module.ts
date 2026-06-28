import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Face } from './entities/face.entity'
import { Person } from '../persons/entities/person.entity'
import { Asset } from '../entities/asset.entity'
import { FacesController } from './faces.controller'
import { FacesQueryController } from './faces-query.controller'
import { FaceThumbController } from './face-thumb.controller'
import { FacesService } from './faces.service'
import { FaceThumbService } from './face-thumb.service'

@Module({
  imports: [TypeOrmModule.forFeature([Face, Person, Asset]), HttpModule],
  controllers: [FacesController, FacesQueryController, FaceThumbController],
  providers: [FacesService, FaceThumbService],
  exports: [FacesService],
})
export class FacesModule {}
