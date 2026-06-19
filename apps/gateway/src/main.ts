import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { loadEnv } from '@photox/shared-config'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule)

  app.enableCors({
    origin: ['http://localhost:5173', 'http://0.0.0.0:5173'],
    credentials: true,
  })

  await app.listen(env.GATEWAY_PORT)
  console.log(`Gateway running on port ${env.GATEWAY_PORT}`)
}

void bootstrap()
