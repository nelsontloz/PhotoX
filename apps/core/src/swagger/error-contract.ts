import type {
  ComponentsObject,
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger';
import { API_ERROR_CODES } from '@photox/shared-types';
import { isAdminRoute, isOpenRoute, isWorkerRoute } from '../auth/open-routes';

/**
 * Post-processes the Swagger document the same way `main.ts` post-processes the response
 * pipeline: one body shape for every non-2xx (`ApiErrorBody` in @photox/shared-types), the
 * access rules from `open-routes.ts`, and the statuses the transport itself can produce.
 * Kept out of the per-route decorators so a new controller cannot forget the contract.
 */

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace';

const OPERATIONS: readonly HttpMethod[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

/** The only rate-limited routes (`RATE_LIMITS` in auth/rate-limit.service.ts). */
const RATE_LIMITED_ROUTES = new Set([
  'post /api/v1/auth/login',
  'post /api/v1/auth/register',
  'post /api/v1/auth/refresh',
]);

const ERROR_SCHEMA_REF = { $ref: '#/components/schemas/ApiError' } as const;

const API_ERROR_SCHEMA: SchemaObject = {
  type: 'object',
  description:
    'The single body shape for every non-2xx response (`ApiErrorBody` in @photox/shared-types). ' +
    'Clients branch on the stable `code`, never on the prose `message`; `Retry-After` is also ' +
    'sent as a header when `retryAfterSec` is present.',
  required: ['statusCode', 'code', 'message'],
  properties: {
    statusCode: { type: 'integer', description: 'HTTP status, repeated in the body.' },
    code: {
      type: 'string',
      enum: [...API_ERROR_CODES],
      description: 'Stable machine-readable failure code.',
    },
    message: { type: 'string', description: 'Human-readable sentence, safe to display.' },
    details: {
      type: 'array',
      description: 'Field-level failures, present on validation errors.',
      items: {
        type: 'object',
        required: ['message'],
        properties: { field: { type: 'string' }, message: { type: 'string' } },
      },
    },
    retryAfterSec: { type: 'integer', description: 'Seconds to wait before retrying.' },
    requestId: { type: 'string', description: 'Correlates the failure with the server log.' },
  },
};

function errorResponse(description: string): ResponseObject {
  return {
    description,
    content: { 'application/json': { schema: ERROR_SCHEMA_REF } },
  };
}

function ensureResponse(operation: OperationObject, status: string, description: string): void {
  operation.responses[status] ??= errorResponse(description);
}

/** `parameters` may hold references; follow them through `components.parameters`. */
function resolveParameter(
  document: OpenAPIObject,
  parameter: ParameterObject | ReferenceObject,
): ParameterObject | undefined {
  let current: ParameterObject | ReferenceObject = parameter;
  // shortcut: ref chains longer than 5 hops are not something this repo emits
  for (let hop = 0; hop < 5 && '$ref' in current; hop++) {
    const name = current.$ref.split('/').pop();
    const next = name ? document.components?.parameters?.[name] : undefined;
    if (!next) return undefined;
    current = next;
  }
  return '$ref' in current ? undefined : current;
}

function hasQueryParameter(
  document: OpenAPIObject,
  item: PathItemObject,
  operation: OperationObject,
): boolean {
  const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])];
  return parameters.some((parameter) => resolveParameter(document, parameter)?.in === 'query');
}

function ensureSecuritySchemes(components: ComponentsObject): void {
  components.securitySchemes ??= {};
  // createDocument already declares bearerAuth via DocumentBuilder.addBearerAuth(); kept here so
  // the security requirement never dangles if that call is dropped from main.ts
  components.securitySchemes.bearerAuth ??= { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' };
  components.securitySchemes.cookieAuth = { type: 'apiKey', in: 'cookie', name: 'photox_access' };
  // the internal job surface: a delegated `act` token plus the payload's job binding
  components.securitySchemes.workerJobSignature = {
    type: 'apiKey',
    in: 'header',
    name: 'X-Job-Signature',
    description: 'HMAC binding of the job payload; sent together with the worker `act` Bearer.',
  };
}

export function applyErrorContract(document: OpenAPIObject): void {
  const components = (document.components ??= {});
  (components.schemas ??= {}).ApiError = API_ERROR_SCHEMA;
  ensureSecuritySchemes(components);

  // a hand-built/test document may omit paths
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!item) continue;
    const open = isOpenRoute(path);
    const admin = isAdminRoute(path);

    for (const method of OPERATIONS) {
      const operation = item[method];
      if (!operation) continue;
      operation.responses ??= {};

      if (!open) operation.security = [{ bearerAuth: [] }, { cookieAuth: [] }];
      // internal job surface: not a user credential — say what it actually takes
      if (isWorkerRoute(path))
        operation.security = [{ bearerAuth: [] }, { workerJobSignature: [] }];
      ensureResponse(operation, '500', 'Unexpected server error.');
      if (!open) ensureResponse(operation, '401', 'Missing, invalid or revoked credentials.');
      if (admin) ensureResponse(operation, '403', 'Authenticated, but not an admin.');
      if (operation.requestBody || hasQueryParameter(document, item, operation)) {
        ensureResponse(operation, '400', 'Request validation failed.');
      }
      if (RATE_LIMITED_ROUTES.has(`${method} ${path.replace(/\/$/, '')}`)) {
        ensureResponse(operation, '429', 'Rate limit exceeded; wait `retryAfterSec` seconds.');
      }

      // Declared error responses share the body: fill in the shape, keep their description and
      // never touch a 2xx.
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!response || '$ref' in response) continue;
        if (!(Number(status) >= 400) || response.content) continue;
        response.content = { 'application/json': { schema: ERROR_SCHEMA_REF } };
      }
    }
  }
}
