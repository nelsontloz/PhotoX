import type { OpenAPIObject, OperationObject, SchemaObject } from '@nestjs/swagger';
import { API_ERROR_CODES } from '@photox/shared-types';
import { applyErrorContract } from './error-contract';

const ERROR_REF = '#/components/schemas/ApiError';

function makeDocument(): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 'test', version: '1' },
    components: {
      parameters: {
        // a query parameter reached only through a $ref
        refreshHint: { name: 'hint', in: 'query', schema: { type: 'string' } },
      },
    },
    paths: {
      '/health': { get: { responses: { 200: { description: 'ok' } } } },
      '/api/v1/assets': {
        get: {
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: { description: 'ok' } },
        },
        post: {
          requestBody: { content: {} },
          responses: { 201: { description: 'created' } },
        },
      },
      // path parameter only: no 400
      '/api/v1/assets/{id}': {
        delete: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 204: { description: 'deleted' } },
        },
      },
      '/api/v1/admin/users': {
        get: { responses: { 200: { description: 'ok' } } },
      },
      '/api/v1/auth/login': {
        post: {
          requestBody: { content: {} },
          responses: {
            200: { description: 'logged in' },
            401: { description: 'declared: bad credentials' },
          },
        },
      },
      '/api/v1/auth/refresh': {
        post: {
          parameters: [{ $ref: '#/components/parameters/refreshHint' }],
          responses: { 200: { description: 'refreshed' } },
        },
      },
      '/api/v1/auth/logout': {
        post: { responses: { 200: { description: 'logged out' } } },
      },
    },
  };
}

function operation(document: OpenAPIObject, path: string, method: 'get' | 'post' | 'delete') {
  return document.paths[path]![method]!;
}

function contentSchema(response: OperationObject['responses'][string]) {
  if (!response || '$ref' in response) return undefined;
  return response.content?.['application/json']?.schema;
}

function descriptionOf(response: OperationObject['responses'][string]) {
  return response && !('$ref' in response) ? response.description : undefined;
}

describe('applyErrorContract', () => {
  let document: OpenAPIObject;

  beforeEach(() => {
    document = makeDocument();
    applyErrorContract(document);
  });

  it('declares ApiError as the one non-2xx body', () => {
    const schema = document.components?.schemas?.ApiError as SchemaObject | undefined;
    expect(schema?.type).toBe('object');
    expect(schema?.required).toEqual(['statusCode', 'code', 'message']);
    expect((schema?.properties?.statusCode as SchemaObject).type).toBe('integer');
    expect((schema?.properties?.code as SchemaObject).enum).toEqual([...API_ERROR_CODES]);
    expect((schema?.properties?.message as SchemaObject).type).toBe('string');
    expect((schema?.properties?.details as SchemaObject).type).toBe('array');
    expect((schema?.properties?.retryAfterSec as SchemaObject).type).toBe('integer');
    expect((schema?.properties?.requestId as SchemaObject).type).toBe('string');
    expect(schema?.description).toMatch(/single body shape for every non-2xx/);
  });

  it('declares the bearer and cookie security schemes', () => {
    expect(document.components?.securitySchemes?.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(document.components?.securitySchemes?.cookieAuth).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'photox_access',
    });
  });

  it('requires credentials on private operations only', () => {
    expect(operation(document, '/api/v1/assets', 'get').security).toEqual([
      { bearerAuth: [] },
      { cookieAuth: [] },
    ]);
    expect(operation(document, '/health', 'get').security).toBeUndefined();
    expect(operation(document, '/api/v1/auth/login', 'post').security).toBeUndefined();
  });

  it('documents a 500 with the ApiError body on every operation', () => {
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of ['get', 'post', 'delete'] as const) {
        const op = item[method];
        if (!op) continue;
        const response = op.responses['500'];
        expect(response, `${method} ${path}`).toBeDefined();
        expect(contentSchema(response)).toEqual({ $ref: ERROR_REF });
      }
    }
  });

  it('documents 401 on private operations and 403 on admin ones', () => {
    expect(operation(document, '/api/v1/assets', 'get').responses['401']).toBeDefined();
    expect(operation(document, '/api/v1/admin/users', 'get').responses['401']).toBeDefined();
    expect(operation(document, '/api/v1/admin/users', 'get').responses['403']).toBeDefined();
    expect(operation(document, '/api/v1/assets', 'get').responses['403']).toBeUndefined();
    expect(operation(document, '/health', 'get').responses['401']).toBeUndefined();
  });

  it('documents 400 only where a body or query parameter can fail validation', () => {
    expect(operation(document, '/api/v1/assets', 'get').responses['400']).toBeDefined();
    expect(operation(document, '/api/v1/assets', 'post').responses['400']).toBeDefined();
    expect(operation(document, '/api/v1/assets/{id}', 'delete').responses['400']).toBeUndefined();
    // the query parameter arrives through a $ref
    expect(operation(document, '/api/v1/auth/refresh', 'post').responses['400']).toBeDefined();
  });

  it('documents 429 only on the rate-limited auth routes', () => {
    expect(operation(document, '/api/v1/auth/login', 'post').responses['429']).toBeDefined();
    expect(operation(document, '/api/v1/auth/refresh', 'post').responses['429']).toBeDefined();
    expect(operation(document, '/api/v1/auth/logout', 'post').responses['429']).toBeUndefined();
    expect(operation(document, '/api/v1/assets', 'get').responses['429']).toBeUndefined();
  });

  it('keeps declared responses and never overwrites a 2xx', () => {
    const login = operation(document, '/api/v1/auth/login', 'post');
    expect(login.responses['200']).toEqual({ description: 'logged in' });
    // declared error keeps its description, gains the shared body
    expect(descriptionOf(login.responses['401'])).toBe('declared: bad credentials');
    expect(contentSchema(login.responses['401'])).toEqual({ $ref: ERROR_REF });
    expect(operation(document, '/api/v1/assets', 'post').responses['201']).toEqual({
      description: 'created',
    });
  });

  it('is idempotent', () => {
    const once = structuredClone(document);
    applyErrorContract(document);
    expect(document).toEqual(once);
  });
});
