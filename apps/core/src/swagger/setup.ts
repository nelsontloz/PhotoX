import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { applyErrorContract } from './error-contract';
import { API_DESCRIPTION } from './api-description';

/**
 * `methodKey + controller name` (no `Controller` suffix), e.g. `listAssets`, `createAdminUser`.
 * A repeated base gets a numeric discriminator so the document never ships duplicate ids.
 */
export function createOperationIdFactory(): (controllerKey: string, methodKey: string) => string {
  const seen = new Map<string, number>();
  return (controllerKey, methodKey) => {
    const base = `${methodKey}${controllerKey.replace(/Controller$/, '')}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}${count}`;
  };
}

/**
 * One Swagger setup for `main.ts` and the integration harness: the document is only the contract
 * if the error post-processor ran, so both must build it the same way.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Photox API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0')
    // Swagger UI can send the same Bearer access token the API accepts (cookie auth works
    // without this — the browser attaches it)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: createOperationIdFactory(),
  });
  applyErrorContract(document);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
