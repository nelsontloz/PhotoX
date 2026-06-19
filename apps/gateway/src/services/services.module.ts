import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ServicesController } from './services.controller'

@Module({
  imports: [HttpModule],
  controllers: [ServicesController],
})
export class ServicesModule {}
