export interface JwtPayload {
  sub: string
  email: string
  iat: number
  exp: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}
