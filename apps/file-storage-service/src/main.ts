import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { loadEnv } from '@photox/shared-config'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule)

  const config = new DocumentBuilder()
    .setTitle('Photox File Storage Service')
    .setDescription('Object storage for user files')
    .setVersion('1.0')
    .addTag('storage')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' })

  await app.listen(env.FILE_STORAGE_SERVICE_PORT)
  console.log(`File Storage Service running on port ${env.FILE_STORAGE_SERVICE_PORT}`)
}

void bootstrap()
