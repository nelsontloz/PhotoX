import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ResponseObject,
} from '@nestjs/swagger';

/**
 * Stamps the response headers and byte-stream semantics the controllers already implement.
 * Kept out of per-route decorators for the same reason as `error-contract.ts`: one place to
 * audit against `setResourceLocation`, `pipeFileResponse` and the auth cookie helpers.
 */

type StatusRouteMap = Record<string, readonly string[]>;
type HeaderSpec = NonNullable<ResponseObject['headers']>[string];

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** Every route that calls `setResourceLocation()` — statuses it is called for. */
const LOCATION_ROUTES: StatusRouteMap = {
  'post /api/v1/files': ['200', '201'],
  'post /api/v1/uploads': ['201'],
  'post /api/v1/admin/users': ['201'],
  'post /api/v1/albums': ['201'],
  'post /api/v1/shares': ['201'],
  'post /api/v1/admin/backups': ['202'],
  'post /api/v1/admin/backups/{key}/restores': ['202'],
  'post /api/v1/admin/reprocess-runs': ['202'],
  'get /api/v1/admin/users/{id}/delete-status': ['200'],
};

/** `setResourceLocation(..., retryAfterSec)` plus the transport-level 429s. */
const RETRY_AFTER_ROUTES: StatusRouteMap = {
  'post /api/v1/admin/backups': ['202'],
  'post /api/v1/admin/backups/{key}/restores': ['202'],
  'post /api/v1/admin/reprocess-runs': ['202'],
  'get /api/v1/admin/users/{id}/delete-status': ['200'],
  'post /api/v1/auth/login': ['429'],
  'post /api/v1/auth/register': ['429'],
  'post /api/v1/auth/refresh': ['429'],
};

/** `setAuthCookies` / `clearAuthCookies` on the auth surface. */
const SET_COOKIE_ROUTES: StatusRouteMap = {
  'post /api/v1/auth/register': ['201'],
  'post /api/v1/auth/login': ['200'],
  'post /api/v1/auth/refresh': ['200'],
  'post /api/v1/auth/logout': ['204'],
};

/** `pipeFileResponse` routes: 304 + Range/If-None-Match + strong ETag. */
const BYTE_ROUTES: Record<string, readonly string[]> = {
  'get /api/v1/files/{fileId}/stream': ['image/*', 'video/*', 'application/octet-stream'],
  'get /api/v1/assets/{id}/content': ['image/*', 'video/*'],
  'get /api/share/{token}/content': ['image/*', 'video/*'],
  'get /api/share/{token}/assets/{assetId}/content': ['image/*', 'video/*'],
};

const FACE_THUMB_ROUTE = 'get /api/v1/faces/{id}/thumb';

/** Path params whose handlers validate UUIDs (the rest are opaque keys/tokens/timestamps). */
const UUID_PATH_PARAMS = new Set(['id', 'assetId', 'fileId', 'uploadId', 'runId', 'shareId']);

const HEADERS = {
  location: {
    description: 'URL of the created resource, or the status resource to poll.',
    schema: { type: 'string' },
  },
  retryAfter: {
    description: 'Seconds to wait before retrying.',
    schema: { type: 'integer' },
  },
  setCookie: {
    description:
      'Sets or clears the HttpOnly access and refresh cookies. The JSON tokens remain in the body.',
    schema: { type: 'string' },
  },
  etag: {
    description: 'Strong content ETag (the stored sha256).',
    schema: { type: 'string' },
  },
  acceptRanges: {
    description: 'Range requests are supported.',
    schema: { type: 'string', example: 'bytes' },
  },
  contentRange: {
    description: 'Byte range of the returned/requested payload.',
    schema: { type: 'string', example: 'bytes 0-1023/4096' },
  },
} satisfies Record<string, HeaderSpec>;

const RANGE_PARAMETERS: ParameterObject[] = [
  {
    name: 'Range',
    in: 'header',
    required: false,
    description: 'Byte range, e.g. `bytes=0-1023`.',
    schema: { type: 'string' },
  },
  {
    name: 'If-None-Match',
    in: 'header',
    required: false,
    description: 'Previous ETag; a match on a full GET answers 304.',
    schema: { type: 'string' },
  },
];

function splitRoute(route: string): [string, string] {
  const space = route.indexOf(' ');
  return [route.slice(0, space), route.slice(space + 1)];
}

function operationOf(document: OpenAPIObject, route: string): OperationObject | undefined {
  const [method, path] = splitRoute(route);
  const item = document.paths[path];
  return item?.[method as keyof typeof item] as OperationObject | undefined;
}

function responseOf(operation: OperationObject, status: string): ResponseObject | undefined {
  const response = operation.responses?.[status];
  return response && !('$ref' in response) ? response : undefined;
}

function addHeader(response: ResponseObject, name: string, spec: HeaderSpec): void {
  response.headers ??= {};
  response.headers[name] ??= spec;
}

function addStatusHeader(
  operation: OperationObject,
  status: string,
  name: string,
  spec: HeaderSpec,
): void {
  const response = responseOf(operation, status);
  if (response) addHeader(response, name, spec);
}

function addParameter(operation: OperationObject, parameter: ParameterObject): void {
  operation.parameters ??= [];
  const exists = operation.parameters.some(
    (candidate) =>
      !('$ref' in candidate) && candidate.name === parameter.name && candidate.in === parameter.in,
  );
  if (!exists) operation.parameters.push(parameter);
}

function stampHeaders(document: OpenAPIObject): void {
  for (const [route, statuses] of Object.entries(LOCATION_ROUTES)) {
    const operation = operationOf(document, route);
    if (!operation) continue;
    for (const status of statuses) addStatusHeader(operation, status, 'Location', HEADERS.location);
  }

  for (const [route, statuses] of Object.entries(RETRY_AFTER_ROUTES)) {
    const operation = operationOf(document, route);
    if (!operation) continue;
    for (const status of statuses)
      addStatusHeader(operation, status, 'Retry-After', HEADERS.retryAfter);
  }

  for (const [route, statuses] of Object.entries(SET_COOKIE_ROUTES)) {
    const operation = operationOf(document, route);
    if (!operation) continue;
    for (const status of statuses)
      addStatusHeader(operation, status, 'Set-Cookie', HEADERS.setCookie);
  }
}

function stampByteRoutes(document: OpenAPIObject): void {
  for (const [route, mediaTypes] of Object.entries(BYTE_ROUTES)) {
    const operation = operationOf(document, route);
    if (!operation) continue;

    for (const parameter of RANGE_PARAMETERS) addParameter(operation, parameter);

    for (const status of ['200', '206']) {
      const response = responseOf(operation, status);
      if (!response) continue;
      response.content ??= {};
      for (const mediaType of mediaTypes) {
        response.content[mediaType] ??= { schema: { type: 'string', format: 'binary' } };
      }
      addHeader(response, 'ETag', HEADERS.etag);
      addHeader(response, 'Accept-Ranges', HEADERS.acceptRanges);
    }

    for (const status of ['206', '416']) {
      addStatusHeader(operation, status, 'Content-Range', HEADERS.contentRange);
    }
    addStatusHeader(operation, '416', 'ETag', HEADERS.etag);

    operation.responses['304'] ??= {
      description: 'Not modified (If-None-Match matched).',
      headers: { ETag: HEADERS.etag },
    };
  }

  const thumb = operationOf(document, FACE_THUMB_ROUTE);
  const thumbResponse = thumb && responseOf(thumb, '200');
  if (thumbResponse) {
    thumbResponse.content = {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
    };
  }
}

function stampUuidPathParams(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths)) {
    if (!item) continue;
    const parameters = [
      ...(item.parameters ?? []),
      ...METHODS.flatMap((method) => item[method]?.parameters ?? []),
    ];
    for (const parameter of parameters) {
      if ('$ref' in parameter) continue;
      if (parameter.in !== 'path' || !UUID_PATH_PARAMS.has(parameter.name)) continue;
      const schema = parameter.schema;
      if (!schema || '$ref' in schema) continue;
      schema.format ??= 'uuid';
    }
  }
}

export function applyResponseContract(document: OpenAPIObject): void {
  stampHeaders(document);
  stampByteRoutes(document);
  stampUuidPathParams(document);
}
