import { Controller, Get } from '@nestjs/common'

const SERVICE_URLS = {
  'user-service': process.env.USER_SERVICE_URL || 'http://localhost:3001',
  'library-service': process.env.LIBRARY_SERVICE_URL || 'http://localhost:3002',
  'file-storage-service': process.env.FILE_STORAGE_SERVICE_URL || 'http://localhost:3003',
}

@Controller('api/services')
export class ServicesController {
  @Get()
  list() {
    return {
      gateway: `http://localhost:${process.env.GATEWAY_PORT || 3000}`,
      ...SERVICE_URLS,
    }
  }
}
