import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { loadAuthEnv } from '@photox/shared-auth'
import { GatewayAuthGuard } from './gateway-auth.guard'

@Module({
  imports: [
    // ponytail: registerAsync (not register) — the factory runs after
    // ConfigModule loads root .env; a top-level loadAuthEnv() here would
    // crash host dev where .env isn't in process.env at import time
    JwtModule.registerAsync({
      useFactory: () => ({ secret: loadAuthEnv().AUTH_TOKEN_SECRET }),
    }),
  ],
  providers: [GatewayAuthGuard, { provide: APP_GUARD, useClass: GatewayAuthGuard }],
})
export class GatewayAuthModule {}
