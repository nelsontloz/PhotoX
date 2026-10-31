import type { Request, Response } from 'express'

export const ACCESS_COOKIE = 'photox_access'
export const REFRESH_COOKIE = 'photox_refresh'

/** The explicit credential: `Authorization: Bearer <token>`, else undefined. */
export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (!header) return undefined
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined
}

// ponytail: trust-proxy-1 is set in main.ts, so req.secure already follows
// X-Forwarded-Proto — plain-HTTP host dev keeps working while https gets Secure cookies
function attrs(secure: boolean, path: string, maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path,
    ...(maxAge !== undefined ? { maxAge } : {}),
    ...(secure ? { secure: true } : {}),
  } as const
}

export function setAccessCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
  secure: boolean,
): void {
  res.cookie(ACCESS_COOKIE, token, attrs(secure, '/api', maxAgeMs))
}

export function clearAccessCookie(res: Response, secure: boolean): void {
  res.clearCookie(ACCESS_COOKIE, attrs(secure, '/api'))
}

export function setRefreshCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
  secure: boolean,
): void {
  res.cookie(REFRESH_COOKIE, token, attrs(secure, '/api/v1/auth', maxAgeMs))
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, attrs(secure, '/api/v1/auth'))
}

// manual parse: no cookie-parser dependency; first occurrence of the name wins
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    const value = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      // malformed percent-encoding is attacker-controlled input — treat as absent
      return undefined
    }
  }
  return undefined
}

export function readAccessCookie(req: Request): string | undefined {
  return readCookie(req, ACCESS_COOKIE)
}

export function readRefreshCookie(req: Request): string | undefined {
  return readCookie(req, REFRESH_COOKIE)
}
