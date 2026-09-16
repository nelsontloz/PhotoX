import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Person } from '@photox/data-access'
import { Face } from '@photox/data-access'
import { Asset } from '@photox/data-access'
import { PersonsService } from './persons.service'
import { PersonsController } from './persons.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Person, Face, Asset])],
  controllers: [PersonsController],
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}
