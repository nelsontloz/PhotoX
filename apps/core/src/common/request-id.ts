import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

// A caller-supplied id is accepted only when it is short and boring: it ends up in logs and in a
// response header, so free-form text (newlines, quotes) must never pass through.
const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

interface RequestWithId extends Request {
  requestId?: string;
}

/** Echoes a sane inbound `X-Request-Id` or mints one, so a log line can be tied to a client report. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  (req as RequestWithId).requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function requestIdOf(req: unknown): string | undefined {
  return (req as RequestWithId | undefined)?.requestId;
}
