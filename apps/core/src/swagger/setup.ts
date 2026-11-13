import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { applyErrorContract } from './error-contract';

/**
 * One Swagger setup for `main.ts` and the integration harness: the document is only the contract
 * if the error post-processor ran, so both must build it the same way.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Photox API')
    .setDescription('Photo hosting API')
    .setVersion('1.0')
    // Swagger UI can send the same Bearer access token the API accepts (cookie auth works
    // without this — the browser attaches it)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  applyErrorContract(document);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
