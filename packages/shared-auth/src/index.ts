import type { Role } from '@photox/shared-types'
export type { Role }

export { loadAuthEnv, type AuthEnv } from './env'

export interface JwtPayload {
  sub: string
  email: string
  role: Role
  iat: number
  exp: number
  jti?: string
}
