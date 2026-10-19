import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FileRecord } from '../database/entities'
import { User } from './entities/user.entity'
import { RefreshToken } from './entities/refresh-token.entity'
import { StorageModule } from '../files/storage/storage.module'
import { BackupModule } from '../backup/backup.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RateLimitService } from './rate-limit.service'
import { TokenService } from './tokens/token.service'
import { AdminController } from './admin/admin.controller'
import { AdminService } from './admin/admin.service'
import { UserDeleteProcessor } from './admin/user-delete.processor'
import { UserDeleteService } from './admin/user-delete.service'

@Module({
  // BullMqService is @Global; StorageModule provides LocalStorageService for the wipe.
  // FileRecord is the only extra repository token the wipe injects — every other table
  // goes through the injected DataSource (all entities are registered app-wide).
  // BackupModule (exports UserBackupService) powers the admin account-edit prefix move;
  // it imports only TypeORM features + Storage/Settings/Places (none import UsersModule).
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, FileRecord]),
    StorageModule,
    BackupModule,
  ],
  controllers: [AuthController, AdminController],
  providers: [
    AuthService,
    AdminService,
    UserDeleteService,
    UserDeleteProcessor,
    TokenService,
    RateLimitService,
  ],
})
export class UsersModule {}
