import type { Request, Response } from 'express'

export const ACCESS_COOKIE = 'photox_access'

// ponytail: secure:false until a TLS proxy exists — then make this conditional on
// app.set('trust proxy') + req.secure so plain-HTTP host dev keeps working
const BASE_COOKIE_ATTRS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/api',
  secure: false,
} as const

export function setAccessCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(ACCESS_COOKIE, token, { ...BASE_COOKIE_ATTRS, maxAge: maxAgeMs })
}

export function clearAccessCookie(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...BASE_COOKIE_ATTRS })
}

// manual parse: no cookie-parser dependency; first occurrence of the name wins
export function readAccessCookie(req: Request): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== ACCESS_COOKIE) continue
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
