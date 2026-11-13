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
