import type { OpenAPIObject, OperationObject, ResponseObject } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { applyResponseContract } from './response-contract';

function makeDocument(): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 'test', version: '1' },
    paths: {
      '/api/v1/files': {
        post: { responses: { 200: { description: 'owned' }, 201: { description: 'created' } } },
      },
      '/api/v1/auth/login': {
        post: { responses: { 200: { description: 'ok' }, 429: { description: 'limited' } } },
      },
      '/api/v1/files/{fileId}/stream': {
        get: {
          parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'stream' },
            206: { description: 'partial' },
            416: { description: 'range' },
          },
        },
      },
      '/api/v1/faces/{id}/thumb': {
        get: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'jpeg' } },
        },
      },
      '/api/v1/assets/{id}': {
        get: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'asset' } },
        },
      },
      '/api/v1/persons/cluster/{jobId}': {
        get: {
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'job' } },
        },
      },
      '/api/v1/uploads/{uploadId}/parts/{index}': {
        put: {
          parameters: [
            { name: 'uploadId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'index', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 204: { description: 'stored' } },
        },
      },
    },
  };
}

function operation(document: OpenAPIObject, path: string, method: 'get' | 'post' | 'put') {
  return document.paths[path]![method]!;
}

function response(operation: OperationObject, status: string): ResponseObject {
  const value = operation.responses[status];
  if (!value || '$ref' in value) throw new Error(`missing inline response ${status}`);
  return value;
}

describe('applyResponseContract', () => {
  it('stamps Location, Retry-After and Set-Cookie on the routes that set them', () => {
    const document = makeDocument();
    applyResponseContract(document);

    expect(
      response(operation(document, '/api/v1/files', 'post'), '200').headers?.Location,
    ).toBeDefined();
    expect(
      response(operation(document, '/api/v1/files', 'post'), '201').headers?.Location,
    ).toBeDefined();
    expect(
      response(operation(document, '/api/v1/auth/login', 'post'), '429').headers?.['Retry-After'],
    ).toBeDefined();
    expect(
      response(operation(document, '/api/v1/auth/login', 'post'), '200').headers?.['Set-Cookie'],
    ).toBeDefined();
  });

  it('documents the byte-stream contract without touching the face thumb', () => {
    const document = makeDocument();
    applyResponseContract(document);

    const stream = operation(document, '/api/v1/files/{fileId}/stream', 'get');
    expect(stream.parameters?.map((p) => ('name' in p ? p.name : ''))).toEqual(
      expect.arrayContaining(['Range', 'If-None-Match']),
    );
    expect(stream.responses['304']).toBeDefined();

    const ok = response(stream, '200');
    expect(ok.headers?.ETag).toBeDefined();
    expect(ok.headers?.['Accept-Ranges']).toBeDefined();
    expect(Object.keys(ok.content ?? {})).toEqual(
      expect.arrayContaining(['image/*', 'video/*', 'application/octet-stream']),
    );

    expect(response(stream, '206').headers?.['Content-Range']).toBeDefined();
    expect(response(stream, '416').headers?.['Content-Range']).toBeDefined();

    const thumb = operation(document, '/api/v1/faces/{id}/thumb', 'get');
    expect(Object.keys(response(thumb, '200').content ?? {})).toEqual(['image/jpeg']);
    expect(thumb.responses['304']).toBeUndefined();
  });

  it('formats UUID path params only', () => {
    const document = makeDocument();
    applyResponseContract(document);

    const formatOf = (path: string, name: string) => {
      const parameter = operation(document, path, 'get').parameters?.find(
        (candidate) => 'name' in candidate && candidate.name === name,
      );
      return parameter && 'schema' in parameter
        ? (parameter.schema as { format?: string }).format
        : undefined;
    };

    expect(formatOf('/api/v1/assets/{id}', 'id')).toBe('uuid');
    expect(formatOf('/api/v1/files/{fileId}/stream', 'fileId')).toBe('uuid');
    expect(formatOf('/api/v1/persons/cluster/{jobId}', 'jobId')).toBeUndefined();
  });

  it('is idempotent', () => {
    const document = makeDocument();
    applyResponseContract(document);
    const once = structuredClone(document);
    applyResponseContract(document);
    expect(document).toEqual(once);
  });
});
