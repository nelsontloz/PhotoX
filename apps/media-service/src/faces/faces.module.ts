import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Face } from './entities/face.entity'
import { FacesController } from './faces.controller'
import { FacesService } from './faces.service'

@Module({
  imports: [TypeOrmModule.forFeature([Face])],
  controllers: [FacesController],
  providers: [FacesService],
  exports: [FacesService],
})
export class FacesModule {}
