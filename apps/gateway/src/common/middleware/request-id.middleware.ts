import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID()
  req.headers['x-request-id'] = requestId
  ;(req as unknown as Record<string, unknown>).requestId = requestId
  next()
}
