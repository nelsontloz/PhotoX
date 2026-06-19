import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { loadEnv } from '@photox/shared-config'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule)
  await app.listen(env.USER_SERVICE_PORT)
  console.log(`User Service running on port ${env.USER_SERVICE_PORT}`)
}

bootstrap()
