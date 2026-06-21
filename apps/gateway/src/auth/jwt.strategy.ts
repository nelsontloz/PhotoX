import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { loadAuthEnv } from '@photox/shared-auth'
import type { JwtPayload } from '@photox/shared-auth'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    const authEnv = loadAuthEnv()
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: authEnv.AUTH_TOKEN_SECRET,
      algorithms: ['HS256'],
      ignoreExpiration: false,
      jsonWebTokenOptions: {
        clockTolerance: authEnv.AUTH_CLOCK_TOLERANCE_SEC,
      },
    })
  }

  validate(payload: JwtPayload): { id: string; email: string } {
    return { id: payload.sub, email: payload.email }
  }
}
