import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadAuthEnv, loadEnv } from '@photox/shared-config';
import { RefreshToken, User } from '../database/entities';
import { SettingsModule } from '../settings/settings.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RateLimitService } from './rate-limit.service';
import { TokenService } from './token.service';

// The auth module owns authentication end to end: the flows (register/login/refresh/logout), the
// token machinery and the route policy the guard enforces. `users/` owns the account records and
// injects AuthService where it needs to revoke a session.
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    SettingsModule,
    // ponytail: registerAsync (not register) — the factory runs after app.module's
    // loadRootEnvFile(); a top-level loadAuthEnv() here would crash host dev
    // where .env isn't in process.env at import time
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
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RateLimitService,
    // ponytail: admin routes enforced inline by JwtAuthGuard (isAdminRoute 403s non-admin)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
