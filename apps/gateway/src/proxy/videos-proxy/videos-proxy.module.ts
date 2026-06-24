import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { VideosProxyController } from './videos-proxy.controller'

@Module({
  imports: [HttpModule],
  controllers: [VideosProxyController],
})
export class VideosProxyModule {}
