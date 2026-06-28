import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Face } from './entities/face.entity'
import { Person } from '../persons/entities/person.entity'
import { FacesController } from './faces.controller'
import { FacesQueryController } from './faces-query.controller'
import { FacesService } from './faces.service'

@Module({
  imports: [TypeOrmModule.forFeature([Face, Person])],
  controllers: [FacesController, FacesQueryController],
  providers: [FacesService],
  exports: [FacesService],
})
export class FacesModule {}
