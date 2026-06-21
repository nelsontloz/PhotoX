import { Controller, Get } from '@nestjs/common'
import { SERVICE_URLS } from '@photox/shared-config'

@Controller('api/services')
export class ServicesController {
  @Get()
  list() {
    return {
      gateway: `http://localhost:${process.env.GATEWAY_PORT ?? 3000}`,
      ...SERVICE_URLS,
    }
  }
}
