import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordService } from './tokens/password.service'
import { TokenService } from './tokens/token.service'
import { User } from '../entities/user.entity'
import { RefreshToken } from '../entities/refresh-token.entity'

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService],
})
export class AuthModule {}
