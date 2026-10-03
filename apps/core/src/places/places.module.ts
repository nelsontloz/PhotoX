import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Place } from '../database/entities/place.entity'
import { PlacesResolveService } from './places-resolve.service'

@Module({
  imports: [TypeOrmModule.forFeature([Place])],
  providers: [PlacesResolveService],
  exports: [PlacesResolveService],
})
export class PlacesModule {}
