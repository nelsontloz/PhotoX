import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { VideosProxyController } from './videos-proxy.controller'
import { HlsProxyService } from './hls-proxy.service'

@Module({
  imports: [HttpModule],
  controllers: [VideosProxyController],
  providers: [HlsProxyService],
})
export class VideosProxyModule {}
