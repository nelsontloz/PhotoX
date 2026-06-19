import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { loadEnv } from '@photox/shared-config'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule)

  const config = new DocumentBuilder()
    .setTitle('Photox Library Service')
    .setDescription('Photo and album library')
    .setVersion('1.0')
    .addTag('library')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' })

  await app.listen(env.LIBRARY_SERVICE_PORT)
  console.log(`Library Service running on port ${env.LIBRARY_SERVICE_PORT}`)
}

void bootstrap()
