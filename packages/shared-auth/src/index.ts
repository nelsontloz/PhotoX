export { loadAuthEnv, type AuthEnv } from './env'

export interface JwtPayload {
  sub: string
  email: string
  iat: number
  exp: number
  jti?: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}
