import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { loadEnv } from '@photox/shared-config'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule)
  await app.listen(env.FILE_STORAGE_SERVICE_PORT)
  console.log(`File Storage Service running on port ${env.FILE_STORAGE_SERVICE_PORT}`)
}

bootstrap()
