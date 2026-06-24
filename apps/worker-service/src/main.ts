import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())

  const config = new DocumentBuilder()
    .setTitle('Photox Worker Service')
    .setDescription('Background job processing (thumbnails)')
    .setVersion('1.0')
    .addTag('health')
    .addTag('jobs')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' })

  const port = Number(process.env.WORKER_SERVICE_PORT) || 3004
  await app.listen(port)
  console.log(`Worker Service running on port ${port}`)
}

void bootstrap()
