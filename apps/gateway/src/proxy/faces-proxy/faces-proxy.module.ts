import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { FacesProxyController } from './faces-proxy.controller'

@Module({
  imports: [HttpModule],
  controllers: [FacesProxyController],
})
export class FacesProxyModule {}
