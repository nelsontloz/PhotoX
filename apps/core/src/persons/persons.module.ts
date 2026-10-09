import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Person } from '../database/entities'
import { Face } from '../database/entities'
import { Asset } from '../database/entities'
import { PersonsService } from './persons.service'
import { PersonsController } from './persons.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Person, Face, Asset])],
  controllers: [PersonsController],
  providers: [PersonsService],
})
export class PersonsModule {}
