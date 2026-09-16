import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { requestIdMiddleware } from './common/middleware/request-id.middleware'
import { loadEnv } from '@photox/shared-config'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule, { rawBody: true })

  app.use(requestIdMiddleware)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())

  app.enableCors({
    origin: ['http://localhost:5173', 'http://0.0.0.0:5173'],
    credentials: true,
  })

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
