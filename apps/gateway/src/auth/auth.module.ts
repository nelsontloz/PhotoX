import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { loadEnv } from '@photox/shared-config'
import { loadAuthEnv } from '@photox/shared-auth'
import { JwtStrategy } from './jwt.strategy'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
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
  providers: [JwtStrategy],
  exports: [PassportModule, JwtModule],
})
export class AuthModule {}
