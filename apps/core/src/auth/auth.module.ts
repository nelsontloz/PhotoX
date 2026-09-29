import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt'
import { loadEnv } from '@photox/shared-config'
import { loadAuthEnv } from '@photox/shared-auth'
import { JwtAuthGuard } from './jwt-auth.guard'

@Module({
  imports: [
    // ponytail: registerAsync (not register) — the factory runs after
    // ConfigModule loads root .env; a top-level loadAuthEnv() here would
    // crash host dev where .env isn't in process.env at import time
    // ponytail: one global registration — access tokens get AUTH_ACCESS_TTL here;
    // refresh tokens are opaque random bytes and never pass through JwtService
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: loadAuthEnv().AUTH_TOKEN_SECRET,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: loadEnv().AUTH_ACCESS_TTL as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  providers: [JwtAuthGuard, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
