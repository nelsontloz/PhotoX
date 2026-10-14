import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'
import {
  UserBackupService,
  type BackupProgress,
  type BackupResult,
  type BackupStatus,
  type RestoreResult,
} from './user-backup.service'

class BackupRequestDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

class RestoreRequestDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

class BackupStatusQueryDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

class BackupProgressQueryDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

// ponytail: admin-only is enforced centrally by JwtAuthGuard (every /api/v1/admin*
// route requires the admin role) — no per-handler role checks here
@ApiTags('admin')
@Controller('api/v1/admin')
export class BackupController {
  constructor(private readonly backups: UserBackupService) {}

  @Post('backups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Back up one user (rows + original bytes) to S3 (admin-only)',
    description:
      'Original bytes first, manifest.json last (rerun-safe fixed keys). ' +
      'Layout backups/<email>__<userId>/ — an email change auto-renames the old prefix ' +
      'via server-side copy (manifest rewritten fresh, old deleted after HEAD verify). ' +
      'Incremental: unchanged bytes are skipped via the previous manifest + S3 listing ' +
      '(uploaded/skipped counters in the result).',
  })
  @ApiResponse({ status: 200, description: 'Backup counts and S3 prefix' })
  async backup(@Body() dto: BackupRequestDto): Promise<BackupResult> {
    return this.backups.backupUser(dto.emailOrId)
  }

  @Post('restores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore one user from S3 and re-enqueue derivatives (admin-only)',
    description:
      'HARD PREREQUISITE: keep cleanup-orphans paused until the restore completion ' +
      'log (multi-GB restores can exceed the ~10-min orphan grace window). Derivative ' +
      'statuses stay stale until jobs complete (metadata pending for all, ' +
      'persons.faceCount until cluster).',
  })
  @ApiResponse({ status: 200, description: 'Restore counts and re-enqueue totals' })
  async restore(@Body() dto: RestoreRequestDto): Promise<RestoreResult> {
    return this.backups.restoreUser(dto.emailOrId)
  }

  @Get('backups/status')
  @ApiOperation({ summary: 'Backup manifest status for one user (admin-only)' })
  @ApiResponse({ status: 200, description: 'Manifest presence and row counts' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async status(@Query() query: BackupStatusQueryDto): Promise<BackupStatus> {
    return this.backups.backupStatus(query.emailOrId)
  }

  @Get('backups/progress')
  @ApiOperation({ summary: 'Live per-file backup progress for one user (admin-only)' })
  @ApiResponse({ status: 200, description: 'In-progress flag plus per-file counters' })
  @ApiResponse({ status: 404, description: 'No user for emailOrId' })
  async progress(@Query() query: BackupProgressQueryDto): Promise<BackupProgress> {
    return this.backups.getBackupProgress(query.emailOrId)
  }
}
