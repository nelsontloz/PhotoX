import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { DEPRECATED_ON, DEPRECATIONS, toDocPath } from '../common/deprecations';

/**
 * Marks every route in the deprecation registry as `deprecated` on the document, with the same dates
 * the interceptor sends as headers. Driven from the registry so the published contract and the wire
 * behaviour cannot disagree.
 */
export function applyDeprecations(document: OpenAPIObject): void {
  for (const deprecation of DEPRECATIONS) {
    // the registry is Express-style (`:id`) for runtime matching; the document uses `{id}`
    const docPath = toDocPath(deprecation.path);
    const operation = document.paths[docPath]?.[
      deprecation.method.toLowerCase() as keyof DocumentPathItem
    ] as (OperationObject & Record<string, unknown>) | undefined;
    if (!operation) continue;
    operation.deprecated = true;
    operation['x-deprecated-on'] = DEPRECATED_ON;
    operation['x-sunset'] = deprecation.sunset;
    if (deprecation.replacement) {
      operation['x-replacement'] =
        `${deprecation.replacement.method} ${deprecation.replacement.path}`;
    }
  }
}

type DocumentPathItem = OpenAPIObject['paths'][string];
