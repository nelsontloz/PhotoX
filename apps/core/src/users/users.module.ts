import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User } from './entities/user.entity'
import { RefreshToken } from './entities/refresh-token.entity'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RateLimitService } from './rate-limit.service'
import { TokenService } from './tokens/token.service'
import { AdminController } from './admin/admin.controller'
import { AdminService } from './admin/admin.service'

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AdminService, TokenService, RateLimitService],
})
export class UsersModule {}
