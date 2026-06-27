import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  const port = Number(process.env.WORKER_SERVICE_PORT) || 3004
  await app.listen(port)
  console.log(`Worker Service running on port ${port}`)
}

void bootstrap()
