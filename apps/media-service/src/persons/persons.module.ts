import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Person } from './entities/person.entity'
import { Face } from '../faces/entities/face.entity'
import { Asset } from '../entities/asset.entity'
import { PersonsService } from './persons.service'
import { PersonsController } from './persons.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Person, Face, Asset])],
  controllers: [PersonsController],
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}
