import type { Response } from 'express';

/**
 * Points a 201/202 at the resource (or status resource) it created, so a client can follow the
 * header instead of hardcoding the path. `retryAfterSec` is the poll hint for an async start.
 */
export function setResourceLocation(res: Response, location: string, retryAfterSec?: number): void {
  res.setHeader('Location', location);
  if (retryAfterSec !== undefined) res.setHeader('Retry-After', String(retryAfterSec));
}
