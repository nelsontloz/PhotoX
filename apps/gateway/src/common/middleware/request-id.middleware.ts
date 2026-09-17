import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

// ponytail: duplicated from apps/core (no cross-app imports) — extract to a
// shared package if a third copy appears
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID()
  req.headers['x-request-id'] = requestId
  next()
}
