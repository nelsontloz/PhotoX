import type { NextFunction, Request, Response } from 'express';
import { requestIdMiddleware, requestIdOf } from './request-id';

function harness(incoming?: string) {
  const headers: Record<string, string> = {};
  const req = {
    headers: incoming === undefined ? {} : { 'x-request-id': incoming },
  } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => (headers[name.toLowerCase()] = value),
  } as unknown as Response;
  const next = (() => undefined) as NextFunction;
  requestIdMiddleware(req, res, next);
  return { req, headers };
}

describe('requestIdMiddleware', () => {
  it('mints an id when none was sent and echoes it in the response header', () => {
    const { headers } = harness();
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a safe inbound id so a client report maps to the log line', () => {
    const { req, headers } = harness('req-42_abc.def:1');
    expect(headers['x-request-id']).toBe('req-42_abc.def:1');
    expect(requestIdOf(req)).toBe('req-42_abc.def:1');
  });

  it('rejects anything that could inject into a log line or header', () => {
    const { headers } = harness('bad\nid"');
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
