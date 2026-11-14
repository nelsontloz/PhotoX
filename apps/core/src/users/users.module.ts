import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDelete } from '../database/entities';
import { User } from '../database/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { BackupModule } from '../backup/backup.module';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { UserDeleteService } from './admin/user-delete.service';

@Module({
  // Accounts, not authentication: AuthModule owns the flows and is imported for the session
  // revocation the admin edit path needs. BullMqService is @Global, and every table the wipe
  // touches goes through the injected DataSource (all entities are registered app-wide) — only
  // the User and UserDelete repository tokens are module-local. BackupModule (exports
  // UserBackupService) powers the admin account-edit prefix move.
  imports: [TypeOrmModule.forFeature([User, UserDelete]), AuthModule, BackupModule],
  controllers: [AdminController],
  providers: [AdminService, UserDeleteService],
  // UserDeleteService is also driven by the worker's `user-delete` consumer through
  // WorkerController's purge route — core consumes no queue itself.
  exports: [UserDeleteService],
})
export class UsersModule {}
