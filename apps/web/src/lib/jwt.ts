import { jwtDecode } from 'jwt-decode'
import type { JwtPayload } from '@photox/shared-auth'

export function getAccessTokenExp(token: string): number | null {
  try {
    const payload = jwtDecode<JwtPayload>(token)
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}
