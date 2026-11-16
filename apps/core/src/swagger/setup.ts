import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { applyErrorContract } from './error-contract';

/**
 * The API-level policy clients can rely on. Kept here (not in a prose doc) so it ships with the
 * document it describes.
 */
const API_DESCRIPTION = `Photo hosting API.

**Versioning.** The path version (\`/api/v1\`) is additive-only: new routes, fields, optional
parameters and error codes may appear at any time. Removing or renaming a field, route or error
code, or changing a status code's meaning, is breaking and needs a new path version.

**Deprecation.** A route that will be removed is marked \`deprecated\` here and answers with a
\`Sunset\` header for at least one release before it disappears. Nothing is removed silently.

**Frozen surfaces.** \`/api/share/:token/*\` is permanent — share tokens are embedded in links
that outlive any deploy, so that namespace never changes shape. \`/worker/*\` and \`/health\` are
internal and unversioned: they may change without notice.

**Concurrency.** Byte reads (\`/assets/:id/content\`, \`/files/:fileId/stream\`, \`/faces/:id/thumb\`)
carry a strong \`ETag\` and honour \`If-None-Match\`/\`Range\`. JSON resources are last-write-wins:
\`updatedAt\` in the payload is the only change signal, there is no \`If-Match\` check.

**Paging.** Every list answers \`{items, total}\`, plus \`nextCursor\` on keyset routes. \`/assets\`
and \`/albums/:id/assets\` page by cursor (offset is only meaningful on the first call); \`/shares\`
and \`/api/share/:token/assets\` by cursor only; \`/albums\`, \`/persons\`, \`/admin/users\`, \`/search\`
and \`/admin/backups/overview\` by offset. The timeline keeps its own \`nextOffset\`/\`version\`.`;

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
    // Default operation ids are derived from the controller + handler and are noisy for codegen;
    // the class name + handler is unique across this tree and reads as one identifier.
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}${methodKey[0]!.toUpperCase()}${methodKey.slice(1)}`,
  });
  applyErrorContract(document);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
