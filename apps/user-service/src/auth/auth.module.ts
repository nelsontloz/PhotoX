import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { loadEnv } from '@photox/shared-config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordService } from './tokens/password.service'
import { TokenService, AUTH_CLOCK_TOLERANCE } from './tokens/token.service'
import { User } from '../entities/user.entity'
import { RefreshToken } from '../entities/refresh-token.entity'
import { loadAuthEnv } from '../config/auth-env'

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    JwtModule.registerAsync({
      useFactory: () => {
        const authEnv = loadAuthEnv()
        const sharedEnv = loadEnv()
        return {
          secret: authEnv.AUTH_TOKEN_SECRET,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: sharedEnv.AUTH_ACCESS_TTL,
          },
        }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    {
      provide: AUTH_CLOCK_TOLERANCE,
      useFactory: () => loadAuthEnv().AUTH_CLOCK_TOLERANCE_SEC,
    },
  ],
})
export class AuthModule {}
