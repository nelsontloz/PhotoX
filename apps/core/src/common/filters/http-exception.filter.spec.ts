import { BadRequestException, HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(request: Record<string, unknown> = {}) {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, setHeader }),
      getRequest: () => ({ method: 'POST', path: '/api/v1/files', ...request }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, setHeader };
}

function silenceLogs() {
  return {
    error: vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    warn: vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
  };
}

describe('HttpExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a non-HttpException with the generic 500 envelope, never the thrown text', () => {
    const logs = silenceLogs();
    const { host, status, json } = makeHost({ requestId: 'req-1' });

    new HttpExceptionFilter().catch(new Error('db exploded'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: 'req-1',
    });
    const logged = String(logs.error.mock.calls[0]?.[0]);
    expect(logged).toContain('POST /api/v1/files');
    expect(logged).toContain('Error: db exploded');
  });

  it('normalizes a string body into the envelope and omits requestId when absent', () => {
    const logs = silenceLogs();
    const { host, status, json } = makeHost();

    new HttpExceptionFilter().catch(new HttpException('nope', 400), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'nope',
    });
    expect(json.mock.calls[0]?.[0]).not.toHaveProperty('requestId');
    expect(logs.error).not.toHaveBeenCalled();
    expect(String(logs.warn.mock.calls[0]?.[0])).toContain('nope');
  });

  it('joins a validation message array into details and drops the error reason phrase', () => {
    silenceLogs();
    const { host, json } = makeHost();

    new HttpExceptionFilter().catch(
      new BadRequestException({
        statusCode: 400,
        message: ['limit must be positive', 'offset must be an integer'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'limit must be positive; offset must be an integer',
      details: [{ message: 'limit must be positive' }, { message: 'offset must be an integer' }],
    });
  });

  it('keeps a VALIDATION_FAILED body and its field details', () => {
    silenceLogs();
    const { host, json } = makeHost();
    const details = [{ field: 'address.street', message: 'street must be a string' }];

    new HttpExceptionFilter().catch(
      new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'street must be a string',
        details,
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'street must be a string',
      details,
    });
  });

  it('preserves an ingest code and its extra keys', () => {
    silenceLogs();
    const { host, json } = makeHost();

    new HttpExceptionFilter().catch(
      new HttpException(
        {
          statusCode: 409,
          code: 'PARTS_MISSING',
          message: 'Upload is missing parts',
          receivedParts: [0, 2],
          uploadId: 'up-1',
        },
        409,
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      code: 'PARTS_MISSING',
      message: 'Upload is missing parts',
      receivedParts: [0, 2],
      uploadId: 'up-1',
    });
  });

  it('falls back to the status default when the body code is unknown', () => {
    silenceLogs();
    const { host, json } = makeHost();

    new HttpExceptionFilter().catch(
      new HttpException({ statusCode: 404, code: 'NOT_A_CODE', message: 'gone' }, 404),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'gone',
    });
  });

  it('sets Retry-After from retryAfterSec and keeps the field in the body', () => {
    silenceLogs();
    const { host, status, json, setHeader } = makeHost();

    new HttpExceptionFilter().catch(
      new HttpException(
        { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSec: 42 },
        429,
      ),
      host,
    );

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      retryAfterSec: 42,
    });
  });

  it('logs the normalized body of a 5xx HttpException', () => {
    const logs = silenceLogs();
    const { host } = makeHost();

    new HttpExceptionFilter().catch(
      new HttpException({ statusCode: 503, message: 'upstream gone' }, 503),
      host,
    );

    expect(String(logs.error.mock.calls[0]?.[0])).toContain('"code":"SERVICE_UNAVAILABLE"');
    expect(String(logs.error.mock.calls[0]?.[0])).toContain('"message":"upstream gone"');
  });
});

/**
 * RFC 7807-flavoured negotiation: the same envelope is serialized as
 * `application/problem+json` when the Accept header asks for it, adding `status`/`detail`
 * aliases, while the plain `application/json` body stays byte-compatible.
 */
function makeNegotiationHost(accept?: string): {
  host: ArgumentsHost;
  response: {
    statusCode: number;
    body: unknown;
    contentType: string;
    headers: Record<string, string>;
  };
} {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    contentType: '',
    headers: {} as Record<string, string>,
  };

  const record = (name: string, value: string): void => {
    if (name.toLowerCase() === 'content-type') response.contentType = value;
    else response.headers[name.toLowerCase()] = value;
  };

  const res = {
    status(code: number) {
      response.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      // Express defaults the content type when the handler never set one.
      if (response.contentType === '') response.contentType = 'application/json';
      response.body = payload;
      return res;
    },
    type(value: string) {
      record('Content-Type', value);
      return res;
    },
    contentType(value: string) {
      record('Content-Type', value);
      return res;
    },
    setHeader(name: string, value: string) {
      record(name, value);
      return res;
    },
    set(name: string, value: string) {
      record(name, value);
      return res;
    },
    getHeader(name: string) {
      return name.toLowerCase() === 'content-type'
        ? response.contentType
        : response.headers[name.toLowerCase()];
    },
  };

  const request = {
    method: 'GET',
    path: '/api/v1/assets',
    headers: accept === undefined ? {} : { accept },
    requestId: 'rid-1',
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

function negotiationFailure(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'limit must be at least 1',
    details: [{ field: 'limit', message: 'limit must be at least 1' }],
  });
}

describe('HttpExceptionFilter problem+json negotiation', () => {
  beforeEach(() => {
    silenceLogs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the plain application/json body byte-compatible', () => {
    const { host, response } = makeNegotiationHost();
    new HttpExceptionFilter().catch(negotiationFailure(), host);

    expect(response.contentType).toBe('application/json');
    expect(response.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'limit must be at least 1',
      details: [{ field: 'limit', message: 'limit must be at least 1' }],
      requestId: 'rid-1',
    });
    expect(response.body).not.toHaveProperty('status');
    expect(response.body).not.toHaveProperty('detail');
    expect(Object.keys(response.body as Record<string, unknown>)).toEqual([
      'statusCode',
      'code',
      'message',
      'details',
      'requestId',
    ]);
  });

  it('answers application/problem+json when the client asks for it', () => {
    const { host, response } = makeNegotiationHost('application/problem+json');
    new HttpExceptionFilter().catch(negotiationFailure(), host);

    expect(response.contentType).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'limit must be at least 1',
      requestId: 'rid-1',
      status: 400,
      detail: 'limit must be at least 1',
    });
    expect((response.body as { details?: unknown }).details).toEqual([
      { field: 'limit', message: 'limit must be at least 1' },
    ]);
  });

  it('matches the media type case-insensitively and tolerates parameters', () => {
    const { host, response } = makeNegotiationHost('text/html, Application/Problem+JSON; q=0.9');
    new HttpExceptionFilter().catch(negotiationFailure(), host);

    expect(response.contentType).toContain('application/problem+json');
    expect((response.body as { status?: number }).status).toBe(400);
    expect((response.body as { detail?: string }).detail).toBe('limit must be at least 1');
  });

  it('adds the aliases to a non-HttpException 500 as well', () => {
    const { host, response } = makeNegotiationHost('application/problem+json');
    new HttpExceptionFilter().catch(new Error('boom'), host);

    expect(response.contentType).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      status: 500,
      detail: 'Internal server error',
    });
    expect((response.body as { message?: string }).message).toBe('Internal server error');
  });

  it('keeps Retry-After and retryAfterSec on both serializations', () => {
    const exception = new HttpException(
      { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSec: 5 },
      429,
    );

    const plain = makeNegotiationHost();
    new HttpExceptionFilter().catch(exception, plain.host);
    expect(plain.response.headers['retry-after']).toBe('5');
    expect((plain.response.body as { retryAfterSec?: number }).retryAfterSec).toBe(5);

    const problem = makeNegotiationHost('application/problem+json');
    new HttpExceptionFilter().catch(exception, problem.host);
    expect(problem.response.headers['retry-after']).toBe('5');
    expect(problem.response.body).toMatchObject({ retryAfterSec: 5, status: 429 });
  });
});
