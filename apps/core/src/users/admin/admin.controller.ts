import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type {
  AdminUserBackupSync,
  AdminUserDeleteResponse,
  AdminUserDeleteStatus,
  AdminUserListResponse,
  AdminUserSortField,
  AdminUserUpdateResponse,
} from '@photox/shared-types'
import { Query } from '@nestjs/common'
import { CurrentUserId } from '../../auth/jwt-auth.guard'
import { AdminService } from './admin.service'
import { AdminUserIdParamsDto } from './dto/admin-user-id.params.dto'
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query.dto'
import { UpdateAdminUserDto } from './dto/update-admin-user.body.dto'

// ponytail: admin-only is enforced centrally by JwtAuthGuard (every /api/v1/admin*
// route requires the admin role) — no per-handler role checks here. Worker `act`
// tokens are default-denied on these routes (not in the worker allowlist).
@ApiTags('admin')
@Controller('api/v1/admin/users')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'List all users (admin-only, trusts the network)' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  async list(@Query() q: ListAdminUsersQueryDto): Promise<AdminUserListResponse> {
    const [rawField = 'createdAt', rawDir] = q.sort?.split(':') ?? []
    const field = rawField as AdminUserSortField
    const dir = rawDir === 'asc' ? 'asc' : 'desc'
    return this.admin.listUsers({
      limit: q.limit,
      offset: q.offset,
      q: q.q,
      sortField: field,
      sortDir: dir,
      role: q.role,
    })
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a user account (admin-only)',
    description:
      'Applies only fields that actually differ (displayName trimmed, email stored ' +
      'normalized, password always rehashed). Email/password changes revoke every ' +
      'session for the user; the S3 backup prefix moves to the new email key. A ' +
      'backup-move failure never fails the edit — retry POST :id/backup-sync.',
  })
  @ApiResponse({ status: 200, description: 'Updated user row plus backup-sync outcome' })
  @ApiResponse({ status: 400, description: 'No changes to apply or blank displayName' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async update(
    @Param() params: AdminUserIdParamsDto,
    @Body() body: UpdateAdminUserDto,
    @CurrentUserId() requesterId: string,
  ): Promise<AdminUserUpdateResponse> {
    return this.admin.updateUser(params.id, body, requesterId)
  }

  @Post(':id/backup-sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a user backup prefix to the current email key (admin-only)',
    description:
      'Idempotent retry for a failed post-edit move: relocates the S3 backup prefix ' +
      'for the live user row. Never throws for storage failures — the outcome is ' +
      'reported as { synced, moved, from?, to, reason?, error? }.',
  })
  @ApiResponse({ status: 200, description: 'Backup-sync outcome' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async backupSync(@Param() params: AdminUserIdParamsDto): Promise<AdminUserBackupSync> {
    return this.admin.syncUserBackup(params.id)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Delete a user asynchronously (admin-only)',
    description:
      'Enqueues BullMQ job `user-delete-<userId>` and returns 202 — the UI polls ' +
      'GET :id/delete-status. Wipes sessions, shares, faces/persons, albums, assets ' +
      '(incl. trashed), files and the user row plus all stored bytes. The external S3 ' +
      'backup prefix is NEVER touched (backupKept: true). Guards: 404 unknown user, ' +
      '403 self-delete, 409 last admin.',
  })
  @ApiResponse({ status: 202, description: 'Deletion enqueued' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Self-delete is forbidden' })
  @ApiResponse({ status: 409, description: 'Cannot delete the last admin' })
  async remove(
    @Param() params: AdminUserIdParamsDto,
    @CurrentUserId() requesterId: string,
  ): Promise<AdminUserDeleteResponse> {
    return this.admin.requestUserDelete(params.id, requesterId)
  }

  @Get(':id/delete-status')
  @ApiOperation({ summary: 'Poll async user-deletion state (admin-only)' })
  @ApiResponse({ status: 200, description: 'Job state plus the kept backup prefix' })
  @ApiResponse({ status: 404, description: 'User not found and no finished run recorded' })
  async deleteStatus(@Param() params: AdminUserIdParamsDto): Promise<AdminUserDeleteStatus> {
    return this.admin.getUserDeleteStatus(params.id)
  }
}
