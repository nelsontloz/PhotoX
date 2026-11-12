import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', path: '/api/v1/files' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the thrown error and answers 500 with the generic body', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = makeHost();

    new HttpExceptionFilter().catch(new Error('db exploded'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).toContain('POST /api/v1/files');
    expect(logged).toContain('Error: db exploded');
  });

  it('answers 4xx HttpExceptions with their own body and logs nothing', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = makeHost();

    new HttpExceptionFilter().catch(new HttpException('nope', 400), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith('nope');
    expect(error).not.toHaveBeenCalled();
  });

  it('logs the response body of a 5xx HttpException', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host } = makeHost();

    new HttpExceptionFilter().catch(
      new HttpException({ statusCode: 503, message: 'upstream gone' }, 503),
      host,
    );

    expect(String(error.mock.calls[0]?.[0])).toContain(
      '{"statusCode":503,"message":"upstream gone"}',
    );
  });
});
