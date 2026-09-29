import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { loadEnv } from '@photox/shared-config'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule, { rawBody: true })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())

  // ponytail: no CORS — browsers reach the API same-origin via the Vite proxy / reverse proxy
  const config = new DocumentBuilder()
    .setTitle('Photox API')
    .setDescription('Photo hosting API')
    .setVersion('1.0')
    .addTag('auth')
    .addTag('users')
    .addTag('admin')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' })

  await app.listen(env.API_PORT)
  console.log(`API running on port ${env.API_PORT}`)
}

void bootstrap()
